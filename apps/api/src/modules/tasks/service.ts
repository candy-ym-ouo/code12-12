import { Prisma } from "@prisma/client";
import { getOwnedObservation, getOwnedPhenophase, getOwnedSite, getOwnedSpecies } from "../../lib/access";
import { isValidDateString, todayInTimezone } from "../../lib/date";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import {
  completionKind,
  daysUntilDue,
  isOverdue,
  isReminderDue,
  resolveOccurrence,
  type Occurrence,
} from "../../lib/taskScheduler";
import type {
  CompleteTaskInput,
  CreateTaskRuleInput,
  ListTasksQuery,
  UpdateTaskRuleInput,
} from "./schema";

const KIND_CATEGORY: Record<string, string | null> = {
  PLANT_PHENOLOGY: "PLANT",
  INSECT_SIGHTING: "INSECT",
  BIRD_SOUND: "BIRD",
  WEATHER_ANOMALY: null,
};

const ruleInclude = {
  site: { select: { id: true, name: true } },
  species: { select: { id: true, commonName: true } },
  phenophase: { select: { id: true, name: true, color: true } },
} satisfies Prisma.ObservationTaskRuleInclude;

const taskInclude = {
  rule: { include: ruleInclude },
  observation: {
    select: { id: true, observationDate: true, title: true, kind: true },
  },
  events: { orderBy: { occurredAt: "asc" } },
} satisfies Prisma.ObservationTaskInclude;

type RuleWithRelations = Prisma.ObservationTaskRuleGetPayload<{ include: typeof ruleInclude }>;
type TaskWithRelations = Prisma.ObservationTaskGetPayload<{ include: typeof taskInclude }>;

export type ScanResult = { created: number; reminders: number; overdue: number; usersScanned: number };

// ── 序列化 ─────────────────────────────────────────────────────────────────

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function serializeEvent(event: {
  id: string;
  taskId: string;
  ownerId: string;
  type: string;
  payload: string;
  occurredAt: Date;
}) {
  return {
    id: event.id,
    taskId: event.taskId,
    type: event.type,
    payload: parsePayload(event.payload),
    occurredAt: event.occurredAt,
  };
}

export function serializeTask(task: TaskWithRelations, today: string) {
  const overdue = isOverdue(task, today);
  return {
    id: task.id,
    status: task.status,
    occurrenceKey: task.occurrenceKey,
    windowStart: task.windowStart,
    windowEnd: task.windowEnd,
    dueDate: task.dueDate,
    reminderSentAt: task.reminderSentAt,
    completedAt: task.completedAt,
    completedDate: task.completedDate,
    closedAt: task.closedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    overdue,
    daysUntilDue: task.status === "OPEN" ? daysUntilDue(task.dueDate, today) : null,
    rule: {
      id: task.rule.id,
      name: task.rule.name,
      kind: task.rule.kind,
      remindBeforeDays: task.rule.remindBeforeDays,
      site: task.rule.site,
      species: task.rule.species,
      phenophase: task.rule.phenophase,
    },
    observation: task.observation,
    events: task.events.map(serializeEvent),
  };
}

// ── 历史事件（只追加）──────────────────────────────────────────────────────

export const TASK_EVENTS = {
  CREATED: "CREATED",
  REMINDER_SENT: "REMINDER_SENT",
  OVERDUE: "OVERDUE",
  COMPLETED: "COMPLETED",
  BACKFILLED: "BACKFILLED",
  CLOSED: "CLOSED",
} as const;

/**
 * 追加一条历史。@@unique([taskId, type]) 保证每种事件至多一条：
 * 重复扫描/并发完成/重复关闭都不会写出第二条；已存在时返回 false。
 * 先查后插避免常规路径产生预期内的约束错误日志，竞态下仍由唯一约束兜底。
 */
async function addEvent(
  tx: Prisma.TransactionClient,
  input: { taskId: string; ownerId: string; type: string; payload?: unknown },
): Promise<boolean> {
  const existing = await tx.observationTaskEvent.findUnique({
    where: { taskId_type: { taskId: input.taskId, type: input.type } },
  });
  if (existing) return false;
  try {
    await tx.observationTaskEvent.create({
      data: {
        taskId: input.taskId,
        ownerId: input.ownerId,
        type: input.type,
        payload: JSON.stringify(input.payload ?? {}),
      },
    });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

// ── 规则校验与 CRUD ────────────────────────────────────────────────────────

async function assertRuleRelations(
  userId: string,
  input: { siteId: string; speciesId?: string | null; phenophaseId?: string | null; kind: string },
): Promise<void> {
  await getOwnedSite(userId, input.siteId);

  if (input.speciesId) {
    const species = await getOwnedSpecies(userId, input.speciesId);
    const expected = KIND_CATEGORY[input.kind];
    if (expected && species.category !== expected) {
      throw new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", [
        { path: "speciesId", message: `该任务类型需要 ${expected} 类物种`, code: "custom" },
      ]);
    }
  }

  if (input.phenophaseId) {
    if (!input.speciesId) {
      throw new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", [
        { path: "phenophaseId", message: "指定物候阶段时必须同时指定物种", code: "custom" },
      ]);
    }
    const phase = await getOwnedPhenophase(userId, input.phenophaseId);
    if (phase.speciesId !== input.speciesId) {
      throw new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", [
        { path: "phenophaseId", message: "物候阶段不属于所选物种", code: "custom" },
      ]);
    }
  }
}

export async function listRules(userId: string) {
  const rules = await prisma.observationTaskRule.findMany({
    where: { ownerId: userId },
    include: { ...ruleInclude, _count: { select: { tasks: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rules.map((rule) => ({
    id: rule.id,
    name: rule.name,
    kind: rule.kind,
    windowStartMd: rule.windowStartMd,
    windowEndMd: rule.windowEndMd,
    dueOffsetDays: rule.dueOffsetDays,
    remindBeforeDays: rule.remindBeforeDays,
    active: rule.active,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
    site: rule.site,
    species: rule.species,
    phenophase: rule.phenophase,
    taskCount: rule._count.tasks,
  }));
}

export async function createRule(userId: string, input: CreateTaskRuleInput): Promise<RuleWithRelations> {
  await assertRuleRelations(userId, input);
  return prisma.observationTaskRule.create({
    data: {
      ownerId: userId,
      name: input.name,
      siteId: input.siteId,
      speciesId: input.speciesId ?? null,
      phenophaseId: input.phenophaseId ?? null,
      kind: input.kind,
      windowStartMd: input.windowStartMd,
      windowEndMd: input.windowEndMd,
      dueOffsetDays: input.dueOffsetDays,
      remindBeforeDays: input.remindBeforeDays,
      active: input.active,
    },
    include: ruleInclude,
  });
}

async function getOwnedRule(userId: string, ruleId: string) {
  const rule = await prisma.observationTaskRule.findFirst({ where: { id: ruleId, ownerId: userId } });
  if (!rule) throw new ApiError(404, "NOT_FOUND", "任务规则不存在");
  return rule;
}

export async function updateRule(userId: string, ruleId: string, input: UpdateTaskRuleInput) {
  const existing = await getOwnedRule(userId, ruleId);

  if (input.speciesId !== undefined || input.phenophaseId !== undefined) {
    await assertRuleRelations(userId, {
      siteId: existing.siteId,
      kind: existing.kind,
      speciesId: input.speciesId === undefined ? existing.speciesId : input.speciesId,
      phenophaseId: input.phenophaseId === undefined ? existing.phenophaseId : input.phenophaseId,
    });
  }

  return prisma.observationTaskRule.update({
    where: { id: ruleId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.speciesId !== undefined ? { speciesId: input.speciesId } : {}),
      ...(input.phenophaseId !== undefined ? { phenophaseId: input.phenophaseId } : {}),
      ...(input.windowStartMd !== undefined ? { windowStartMd: input.windowStartMd } : {}),
      ...(input.windowEndMd !== undefined ? { windowEndMd: input.windowEndMd } : {}),
      ...(input.dueOffsetDays !== undefined ? { dueOffsetDays: input.dueOffsetDays } : {}),
      ...(input.remindBeforeDays !== undefined ? { remindBeforeDays: input.remindBeforeDays } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
    include: ruleInclude,
  });
}

export async function deleteRule(userId: string, ruleId: string): Promise<void> {
  await getOwnedRule(userId, ruleId);
  // 规则对待办是 Restrict：已有历史任务时禁止删除，停用即可保留完整历史
  const count = await prisma.observationTask.count({ where: { ruleId } });
  if (count > 0) {
    throw new ApiError(409, "RESOURCE_IN_USE", `该规则已产生 ${count} 条待办，请改为停用以保留历史`, {
      count,
    });
  }
  await prisma.observationTaskRule.delete({ where: { id: ruleId } });
}

// ── 扫描生成（幂等核心）─────────────────────────────────────────────────────

/**
 * 确保某规则的某一窗口年存在且仅存在一条待办。
 * 依赖 @@unique([ownerId, ruleId, occurrenceKey])：插入命中约束即复用已有行，
 * 因此无论扫描执行多少次、是否并发，都不会产生第二条待办或第二条 CREATED 事件。
 */
async function ensureOccurrenceTask(
  tx: Prisma.TransactionClient,
  input: { userId: string; rule: RuleWithRelations; occurrence: Occurrence; today: string },
): Promise<{ created: boolean }> {
  const { userId, rule, occurrence, today } = input;
  // 先查后插：常规重复扫描直接复用，不产生约束错误日志
  const existing = await tx.observationTask.findUnique({
    where: {
      ownerId_ruleId_occurrenceKey: {
        ownerId: userId,
        ruleId: rule.id,
        occurrenceKey: occurrence.occurrenceKey,
      },
    },
  });
  if (existing) return { created: false };

  try {
    const task = await tx.observationTask.create({
      data: {
        ownerId: userId,
        ruleId: rule.id,
        occurrenceKey: occurrence.occurrenceKey,
        windowStart: occurrence.windowStart,
        windowEnd: occurrence.windowEnd,
        dueDate: occurrence.dueDate,
      },
    });
    await addEvent(tx, {
      taskId: task.id,
      ownerId: userId,
      type: TASK_EVENTS.CREATED,
      payload: {
        ruleId: rule.id,
        ruleName: rule.name,
        windowStart: task.windowStart,
        windowEnd: task.windowEnd,
        dueDate: task.dueDate,
        generatedOn: today,
      },
    });
    return { created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { created: false };
    }
    throw error;
  }
}

/**
 * 评估用户全部 OPEN 待办：发一次到期前提醒、在首次逾期时留一条逾期历史。
 * 同一状态的通知各只有唯一事件，重复扫描不会重复提醒/重复留痕。
 */
export async function evaluateOpenTasks(
  userId: string,
  today: string,
  now = new Date(),
): Promise<{ reminders: number; overdue: number }> {
  const tasks = await prisma.observationTask.findMany({
    where: { ownerId: userId, status: "OPEN" },
    include: { rule: true },
  });

  let reminders = 0;
  let overdueCount = 0;

  for (const task of tasks) {
    const overdue = today > task.dueDate;
    if (overdue) {
      const recorded = await prisma.$transaction((tx) =>
        addEvent(tx, {
          taskId: task.id,
          ownerId: userId,
          type: TASK_EVENTS.OVERDUE,
          payload: { dueDate: task.dueDate, detectedOn: today },
        }),
      );
      if (recorded) overdueCount += 1;
      continue; // 已逾期则不再补发"即将到期"提醒
    }

    if (isReminderDue(task, today, task.rule.remindBeforeDays)) {
      const sent = await prisma.$transaction(async (tx) => {
        const recorded = await addEvent(tx, {
          taskId: task.id,
          ownerId: userId,
          type: TASK_EVENTS.REMINDER_SENT,
          payload: { dueDate: task.dueDate, sentOn: today },
        });
        if (!recorded) return false;
        await tx.observationTask.update({
          where: { id: task.id },
          data: { reminderSentAt: now },
        });
        return true;
      });
      if (sent) reminders += 1;
    }
  }

  return { reminders, overdue: overdueCount };
}

/** 按用户时区取"今天"，为每条启用规则的当前窗口年 upsert 待办，并推进提醒/逾期。 */
export async function scanUserTasks(userId: string, now = new Date()): Promise<ScanResult> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  const today = todayInTimezone(user.timezone, now);
  const rules = await prisma.observationTaskRule.findMany({
    where: { ownerId: userId, active: true },
    include: ruleInclude,
  });

  let created = 0;
  for (const rule of rules) {
    const occurrence = resolveOccurrence(rule, today);
    if (!occurrence) continue;
    const result = await prisma.$transaction((tx) =>
      ensureOccurrenceTask(tx, { userId, rule, occurrence, today }),
    );
    if (result.created) created += 1;
  }

  const lifecycle = await evaluateOpenTasks(userId, today, now);
  return { created, ...lifecycle, usersScanned: 1 };
}

/** 定时任务入口：逐用户扫描，单个用户失败不影响其他人。 */
export async function scanAllUsers(now = new Date()): Promise<ScanResult> {
  const users = await prisma.user.findMany({ select: { id: true } });
  const total: ScanResult = { created: 0, reminders: 0, overdue: 0, usersScanned: 0 };
  for (const user of users) {
    const result = await scanUserTasks(user.id, now);
    total.created += result.created;
    total.reminders += result.reminders;
    total.overdue += result.overdue;
    total.usersScanned += 1;
  }
  return total;
}

// ── 查询 ──────────────────────────────────────────────────────────────────

async function getOwnedTask(userId: string, taskId: string) {
  const task = await prisma.observationTask.findFirst({ where: { id: taskId, ownerId: userId } });
  if (!task) throw new ApiError(404, "NOT_FOUND", "观察任务不存在");
  return task;
}

export async function listTasks(userId: string, query: ListTasksQuery, today: string) {
  const wantOverdue = query.status === "OVERDUE";
  const statusFilter =
    query.status === "ALL"
      ? {}
      : wantOverdue
        ? { status: "OPEN" }
        : { status: query.status as "OPEN" | "DONE" | "CLOSED" };

  const tasks = await prisma.observationTask.findMany({
    where: {
      ownerId: userId,
      ...statusFilter,
      ...(query.siteId ? { rule: { siteId: query.siteId } } : {}),
      ...(query.ruleId ? { ruleId: query.ruleId } : {}),
    },
    include: taskInclude,
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    take: query.limit,
  });

  return tasks
    .map((task) => serializeTask(task, today))
    .filter((task) => (wantOverdue ? task.overdue : true));
}

export async function getTask(userId: string, taskId: string, today: string) {
  await getOwnedTask(userId, taskId);
  const task = await prisma.observationTask.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude });
  return serializeTask(task, today);
}

export async function listTaskEvents(userId: string, taskId: string, limit: number) {
  await getOwnedTask(userId, taskId);
  const events = await prisma.observationTaskEvent.findMany({
    where: { taskId, ownerId: userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  return events.map(serializeEvent);
}

export async function listHistoryFeed(userId: string, limit: number) {
  const events = await prisma.observationTaskEvent.findMany({
    where: { ownerId: userId },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
  return events.map(serializeEvent);
}

// ── 完成 / 补录 / 关闭 ─────────────────────────────────────────────────────

function validationError(path: string, message: string): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", [{ path, message, code: "custom" }]);
}

/**
 * 完成待办。
 * - 关联已有观测：校验归属与任务范围一致；
 * - 不关联时按任务模板快速登记一条 PUBLISHED 观测（日期默认今天）；
 * - 观测日期早于今天记 BACKFILLED（补录），否则记 COMPLETED；两类事件各至多一条。
 */
export async function completeTask(userId: string, taskId: string, input: CompleteTaskInput, now = new Date()) {
  const task = await getOwnedTask(userId, taskId);
  if (task.status !== "OPEN") {
    throw new ApiError(409, "TASK_NOT_OPEN", `任务已${task.status === "DONE" ? "完成" : "关闭"}，不能重复完成`, {
      status: task.status,
    });
  }

  const rule = await prisma.observationTaskRule.findUniqueOrThrow({ where: { id: task.ruleId } });
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { timezone: true },
  });
  const today = todayInTimezone(user.timezone, now);

  if (input.observationDate) {
    if (!isValidDateString(input.observationDate)) {
      throw validationError("observationDate", "日期格式应为 YYYY-MM-DD");
    }
    if (input.observationDate > today) {
      throw validationError("observationDate", "完成日期不能晚于今天，未来的观察请到期后再完成");
    }
  }

  let observationId: string | null = null;
  let observationDate: string;

  if (input.observationId) {
    const observation = await getOwnedObservation(userId, input.observationId);
    if (observation.status !== "PUBLISHED") {
      throw validationError("observationId", "关联的观测记录必须是已发布状态");
    }
    if (observation.siteId !== rule.siteId || observation.kind !== rule.kind) {
      throw validationError("observationId", "关联观测的地点或类型与任务不一致");
    }
    if (rule.speciesId && observation.speciesId !== rule.speciesId) {
      throw validationError("observationId", "关联观测的物种与任务不一致");
    }
    if (rule.phenophaseId && observation.phenophaseId !== rule.phenophaseId) {
      throw validationError("observationId", "关联观测的物候阶段与任务不一致");
    }
    observationId = observation.id;
    observationDate = observation.observationDate;
  } else if (input.createObservation === false) {
    if (!input.observationDate) throw validationError("observationDate", "不登记观测时必须提供完成日期");
    if (!isValidDateString(input.observationDate)) {
      throw validationError("observationDate", "日期格式应为 YYYY-MM-DD");
    }
    observationDate = input.observationDate;
  } else {
    observationDate = input.observationDate ?? today;
    if (!isValidDateString(observationDate)) {
      throw validationError("observationDate", "日期格式应为 YYYY-MM-DD");
    }
    const observation = await prisma.observation.create({
      data: {
        ownerId: userId,
        siteId: rule.siteId,
        speciesId: rule.speciesId,
        phenophaseId: rule.phenophaseId,
        kind: rule.kind,
        status: "PUBLISHED",
        observationDate,
        title: rule.name,
        notes: input.notes ?? `由观察任务「${rule.name}」登记`,
        source: "TASK",
      },
      select: { id: true },
    });
    observationId = observation.id;
  }

  const eventType = completionKind(observationDate, today) === "BACKFILLED"
    ? TASK_EVENTS.BACKFILLED
    : TASK_EVENTS.COMPLETED;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.observationTask.update({
        where: { id: taskId },
        data: {
          status: "DONE",
          completedAt: now,
          completedDate: observationDate,
          observationId,
        },
      });
      const recorded = await addEvent(tx, {
        taskId,
        ownerId: userId,
        type: eventType,
        payload: {
          observationDate,
          completedOn: today,
          observationId,
          backfilled: eventType === TASK_EVENTS.BACKFILLED,
          daysLate: observationDate > task.dueDate ? daysUntilDue(task.dueDate, observationDate) : 0,
        },
      });
      if (!recorded) throw new ApiError(409, "TASK_ALREADY_COMPLETED", "任务已被完成，请勿重复提交");
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "TASK_ALREADY_COMPLETED", "任务已被完成，请勿重复提交");
    }
    throw error;
  }

  return getTask(userId, taskId, today);
}

export async function closeTask(
  userId: string,
  taskId: string,
  payload: { reason?: string | null } = {},
  now = new Date(),
) {
  const task = await getOwnedTask(userId, taskId);
  if (task.status !== "OPEN") {
    throw new ApiError(409, "TASK_NOT_OPEN", `任务已是${task.status === "DONE" ? "完成" : "关闭"}状态`, {
      status: task.status,
    });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
  const today = todayInTimezone(user.timezone, now);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.observationTask.update({ where: { id: taskId }, data: { status: "CLOSED", closedAt: now } });
      const recorded = await addEvent(tx, {
        taskId,
        ownerId: userId,
        type: TASK_EVENTS.CLOSED,
        payload: { closedOn: today, reason: payload.reason ?? null },
      });
      if (!recorded) throw new ApiError(409, "TASK_ALREADY_CLOSED", "任务已关闭，请勿重复操作");
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "TASK_ALREADY_CLOSED", "任务已关闭，请勿重复操作");
    }
    throw error;
  }

  return getTask(userId, taskId, today);
}

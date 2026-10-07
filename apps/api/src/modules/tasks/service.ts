import type { Prisma } from "@prisma/client";
import { getOwnedObservation, getOwnedPhenophase, getOwnedSite, getOwnedSpecies, getOwnedTask } from "../../lib/access";
import { daysBetween, todayInTimezone } from "../../lib/date";
import { ApiError } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { candidateYears, reminderDateFor, resolveYearWindow } from "../../lib/taskWindow";
import { logger } from "../../lib/logger";
import type {
  CompleteInstanceInput,
  CreateTaskInput,
  ListTasksQuery,
  SkipInstanceInput,
  UpdateTaskInput,
} from "./schema";

const KIND_CATEGORY: Record<string, string | null> = {
  PLANT_PHENOLOGY: "PLANT",
  INSECT_SIGHTING: "INSECT",
  BIRD_SOUND: "BIRD",
  WEATHER_ANOMALY: null,
};

const taskInclude = {
  site: { select: { id: true, name: true } },
  species: { select: { id: true, commonName: true, category: true } },
  phenophase: { select: { id: true, name: true, color: true } },
  instances: { orderBy: { year: "asc" as const } },
  _count: { select: { events: true } },
} satisfies Prisma.ObservationTaskInclude;

type TaskWithRelations = Prisma.ObservationTaskGetPayload<{ include: typeof taskInclude }>;
export type { TaskWithRelations };

export const taskRelationsInclude = taskInclude;

function validationError(path: string, message: string): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", "请求参数不合法", [{ path, message, code: "custom" }]);
}

function conflict(code: string, message: string, details?: unknown): ApiError {
  return new ApiError(409, code, message, details);
}

async function assertTaskRelations(
  userId: string,
  input: { siteId: string; speciesId?: string | null; phenophaseId?: string | null; kind: string },
): Promise<void> {
  await getOwnedSite(userId, input.siteId);
  if (input.speciesId) {
    const species = await getOwnedSpecies(userId, input.speciesId);
    const expected = KIND_CATEGORY[input.kind];
    if (expected && species.category !== expected) {
      throw validationError("speciesId", `该观测类型需要 ${expected} 类物种，当前物种类别为 ${species.category}`);
    }
  }
  if (input.phenophaseId) {
    if (!input.speciesId) throw validationError("phenophaseId", "指定物候阶段时必须同时指定物种");
    const phase = await getOwnedPhenophase(userId, input.phenophaseId);
    if (phase.speciesId !== input.speciesId) throw validationError("phenophaseId", "物候阶段不属于所选物种");
  }
}

export type InstanceVirtual = {
  isOverdue: boolean;
  reminderDue: boolean;
  daysUntilStart: number;
  daysUntilEnd: number;
  today: string;
};

function instanceVirtual(
  instance: TaskWithRelations["instances"][number],
  timezone: string,
  now: Date,
): InstanceVirtual {
  const today = todayInTimezone(timezone, now);
  return {
    isOverdue: instance.status === "PENDING" && today > instance.windowEndDate,
    reminderDue:
      instance.status === "PENDING" &&
      instance.remindedAt === null &&
      instance.reminderDate !== null &&
      instance.reminderDate <= today &&
      today <= instance.windowEndDate,
    daysUntilStart: daysBetween(today, instance.windowStartDate),
    daysUntilEnd: daysBetween(today, instance.windowEndDate),
    today,
  };
}

export function serializeInstance(
  instance: TaskWithRelations["instances"][number],
  timezone: string,
  now = new Date(),
) {
  return {
    id: instance.id,
    year: instance.year,
    windowStartDate: instance.windowStartDate,
    windowEndDate: instance.windowEndDate,
    reminderDate: instance.reminderDate,
    status: instance.status,
    observationId: instance.observationId,
    completedAt: instance.completedAt,
    completedDate: instance.completedDate,
    completedDaysLate: instance.completedDaysLate,
    completionNote: instance.completionNote,
    remindedAt: instance.remindedAt,
    overdueMarkedAt: instance.overdueMarkedAt,
    reopenedAt: instance.reopenedAt,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    ...instanceVirtual(instance, timezone, now),
  };
}

export function serializeTask(task: TaskWithRelations, now = new Date()) {
  const instances = task.instances.map((instance) => serializeInstance(instance, task.timezone, now));
  const counts = {
    pending: instances.filter((item) => item.status === "PENDING" && !item.isOverdue).length,
    overdue: instances.filter((item) => item.isOverdue).length,
    completed: instances.filter((item) => item.status === "COMPLETED").length,
    backfilled: instances.filter((item) => item.status === "BACKFILLED").length,
    skipped: instances.filter((item) => item.status === "SKIPPED").length,
  };
  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    site: task.site,
    species: task.species,
    phenophase: task.phenophase,
    windowStart: task.windowStart,
    windowEnd: task.windowEnd,
    timezone: task.timezone,
    reminderDays: task.reminderDays,
    note: task.note,
    status: task.status,
    closedAt: task.closedAt,
    eventCount: task._count.events,
    instances,
    summary: counts,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function createTask(userId: string, input: CreateTaskInput, now = new Date()) {
  await assertTaskRelations(userId, input);

  const task = await prisma.observationTask.create({
    data: {
      ownerId: userId,
      title: input.title,
      siteId: input.siteId,
      speciesId: input.speciesId ?? null,
      phenophaseId: input.phenophaseId ?? null,
      kind: input.kind,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      timezone: input.timezone,
      reminderDays: input.reminderDays,
      note: input.note ?? null,
    },
    include: taskInclude,
  });

  await prisma.observationTaskEvent.create({
    data: {
      taskId: task.id,
      type: "CREATED",
      detail: JSON.stringify({
        windowStart: task.windowStart,
        windowEnd: task.windowEnd,
        timezone: task.timezone,
        reminderDays: task.reminderDays,
        siteId: task.siteId,
        speciesId: task.speciesId,
        phenophaseId: task.phenophaseId,
        kind: task.kind,
      }),
    },
  });

  // 创建后立即按当前时区日期扫描一次，当年待办即时可见。
  await scanTaskInstances(task, now);

  return getTask(userId, task.id, now);
}

export async function listTasks(userId: string, query: ListTasksQuery, now = new Date()) {
  const tasks = await prisma.observationTask.findMany({
    where: {
      ownerId: userId,
      ...(query.status === "ALL" ? {} : { status: query.status }),
      ...(query.siteId ? { siteId: query.siteId } : {}),
    },
    include: taskInclude,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return tasks.map((task) => serializeTask(task, now));
}

export async function getTask(userId: string, taskId: string, now = new Date()) {
  const task = await prisma.observationTask.findFirst({
    where: { id: taskId, ownerId: userId },
    include: taskInclude,
  });
  if (!task) throw new ApiError(404, "NOT_FOUND", "观察任务不存在");
  return serializeTask(task, now);
}

export async function listEvents(userId: string, taskId: string) {
  await getOwnedTask(userId, taskId);
  const events = await prisma.observationTaskEvent.findMany({
    where: { taskId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  return events.map((event) => ({
    id: event.id,
    type: event.type,
    instanceId: event.instanceId,
    detail: event.detail ? (JSON.parse(event.detail) as unknown) : null,
    createdAt: event.createdAt,
  }));
}

export async function updateTask(userId: string, taskId: string, input: UpdateTaskInput, now = new Date()) {
  const existing = await getOwnedTask(userId, taskId);
  if (existing.status === "CLOSED") throw conflict("TASK_CLOSED", "任务已关闭，请先重新打开再修改");

  const merged = {
    siteId: input.siteId ?? existing.siteId,
    speciesId: input.speciesId === undefined ? existing.speciesId : input.speciesId,
    phenophaseId: input.phenophaseId === undefined ? existing.phenophaseId : input.phenophaseId,
    kind: input.kind ?? existing.kind,
  };
  await assertTaskRelations(userId, merged);

  const nextWindowStart = input.windowStart ?? existing.windowStart;
  const nextWindowEnd = input.windowEnd ?? existing.windowEnd;
  if (nextWindowStart > nextWindowEnd) {
    throw validationError("windowEnd", "物候窗口起始日不能晚于结束日（暂不支持跨年窗口）");
  }

  const previous = {
    title: existing.title,
    siteId: existing.siteId,
    speciesId: existing.speciesId,
    phenophaseId: existing.phenophaseId,
    kind: existing.kind,
    windowStart: existing.windowStart,
    windowEnd: existing.windowEnd,
    timezone: existing.timezone,
    reminderDays: existing.reminderDays,
    note: existing.note,
  };

  const task = await prisma.observationTask.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.siteId !== undefined ? { siteId: input.siteId } : {}),
      ...(input.speciesId !== undefined ? { speciesId: input.speciesId ?? null } : {}),
      ...(input.phenophaseId !== undefined ? { phenophaseId: input.phenophaseId ?? null } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      windowStart: nextWindowStart,
      windowEnd: nextWindowEnd,
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.reminderDays !== undefined ? { reminderDays: input.reminderDays } : {}),
      ...(input.note !== undefined ? { note: input.note ?? null } : {}),
    },
    include: taskInclude,
  });

  const changed = Object.entries({
    title: input.title,
    siteId: input.siteId,
    speciesId: input.speciesId,
    phenophaseId: input.phenophaseId,
    kind: input.kind,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    timezone: input.timezone,
    reminderDays: input.reminderDays,
    note: input.note,
  }).filter(([, value]) => value !== undefined);

  await prisma.observationTaskEvent.create({
    data: {
      taskId,
      type: "UPDATED",
      detail: JSON.stringify({
        changed: changed.map(([field]) => field),
        previous: Object.fromEntries(changed.map(([field]) => [field, (previous as Record<string, unknown>)[field]])),
      }),
    },
  });

  // 窗口/时区/提醒提前量变化时，就地校正未完成实例的日期，并补齐缺失年份。
  const affectsWindow = changed.some(([field]) =>
    ["windowStart", "windowEnd", "timezone", "reminderDays"].includes(field),
  );
  if (affectsWindow) await scanTaskInstances(task, now, { reconcile: true });

  return getTask(userId, taskId, now);
}

export async function closeTask(userId: string, taskId: string) {
  const task = await getOwnedTask(userId, taskId);
  if (task.status === "CLOSED") throw conflict("TASK_CLOSED", "任务已经处于关闭状态");
  await prisma.observationTask.update({
    where: { id: taskId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await prisma.observationTaskEvent.create({
    data: { taskId, type: "CLOSED", detail: JSON.stringify({ at: new Date().toISOString() }) },
  });
  return getTask(userId, taskId);
}

export async function reopenTask(userId: string, taskId: string, now = new Date()) {
  const task = await getOwnedTask(userId, taskId);
  if (task.status !== "CLOSED") throw conflict("TASK_ACTIVE", "任务当前未关闭");
  const reopened = await prisma.observationTask.update({
    where: { id: taskId },
    data: { status: "ACTIVE", closedAt: null },
    include: taskInclude,
  });
  await prisma.observationTaskEvent.create({
    data: { taskId, type: "REOPENED", detail: JSON.stringify({ at: new Date().toISOString() }) },
  });
  await scanTaskInstances(reopened, now);
  return getTask(userId, taskId, now);
}

// ---------------------------------------------------------------------------
// 扫描：按物候窗口与时区生成/推进实例。对 (taskId, year) 做唯一约束 upsert，
// 因此无论扫描重复多少次、是否并发，都不会产生同一年的第二条实例。
// ---------------------------------------------------------------------------

export type ScanResult = {
  tasksScanned: number;
  instancesCreated: number;
  remindersSent: number;
  overdueMarked: number;
  autoCompleted: number;
  autoBackfilled: number;
};

export async function scanAllTasks(now = new Date()): Promise<ScanResult> {
  const result: ScanResult = {
    tasksScanned: 0,
    instancesCreated: 0,
    remindersSent: 0,
    overdueMarked: 0,
    autoCompleted: 0,
    autoBackfilled: 0,
  };
  const tasks = await prisma.observationTask.findMany({
    where: { status: "ACTIVE" },
    include: taskInclude,
  });
  for (const task of tasks) {
    try {
      const part = await scanTaskInstances(task, now);
      result.tasksScanned += 1;
      for (const key of [
        "instancesCreated",
        "remindersSent",
        "overdueMarked",
        "autoCompleted",
        "autoBackfilled",
      ] as const) {
        result[key] += part[key];
      }
    } catch (error) {
      // 单任务失败不影响其他用户的扫描
      logger.error({ err: error, taskId: task.id }, "观察任务扫描失败");
    }
  }
  return result;
}

type ScanPart = Omit<ScanResult, "tasksScanned">;
export type { ScanPart };

/** 对单个任务执行扫描（用户手动触发"立即扫描"时复用）。 */
export async function scanUserTask(task: TaskWithRelations, now = new Date()): Promise<ScanPart> {
  return scanTaskInstances(task, now);
}

async function scanTaskInstances(
  task: TaskWithRelations,
  now: Date,
  options: { reconcile?: boolean } = {},
): Promise<ScanPart> {
  const part: ScanPart = {
    instancesCreated: 0,
    remindersSent: 0,
    overdueMarked: 0,
    autoCompleted: 0,
    autoBackfilled: 0,
  };
  const today = todayInTimezone(task.timezone, now);
  const years = candidateYears(task.timezone, now);

  for (const year of years) {
    const window = resolveYearWindow(task.windowStart, task.windowEnd, year);
    const reminderDate = reminderDateFor(window, task.reminderDays);
    const existing = task.instances.find((item) => item.year === year) ?? null;

    // 幂等创建：唯一键 (taskId, year) 兜底并发与重复扫描。
    let instance = existing;
    if (!instance) {
      instance = await prisma.observationTaskInstance.upsert({
        where: { taskId_year: { taskId: task.id, year } },
        create: {
          taskId: task.id,
          year,
          windowStartDate: window.startDate,
          windowEndDate: window.endDate,
          reminderDate,
        },
        update: {},
      });
      part.instancesCreated += 1;
    } else if (options.reconcile && instance.status === "PENDING") {
      // 任务窗口被编辑后，校正未完成实例的日期；已提醒/已逾期标记保留。
      instance = await prisma.observationTaskInstance.update({
        where: { id: instance.id },
        data: { windowStartDate: window.startDate, windowEndDate: window.endDate, reminderDate },
      });
    }

    if (instance.status !== "PENDING") continue;

    // 窗口结束后：先尝试自动匹配已登记的观测（按时记录或逾期补录），再标记逾期。
    if (today > instance.windowEndDate) {
      const matched = await findMatchingObservation(task, instance);
      if (matched) {
        const late = Math.max(0, daysBetween(instance.windowEndDate, matched.observationDate));
        const backfilled = matched.observationDate > instance.windowEndDate;
        await prisma.$transaction([
          prisma.observationTaskInstance.update({
            where: { id: instance.id },
            data: {
              status: backfilled ? "BACKFILLED" : "COMPLETED",
              observationId: matched.id,
              completedAt: now,
              completedDate: matched.observationDate,
              completedDaysLate: late,
            },
          }),
          prisma.observationTaskEvent.create({
            data: {
              taskId: task.id,
              instanceId: instance.id,
              type: backfilled ? "BACKFILLED" : "COMPLETED",
              detail: JSON.stringify({
                source: "AUTO_SCAN",
                observationId: matched.id,
                observationDate: matched.observationDate,
                daysLate: late,
              }),
            },
          }),
        ]);
        if (backfilled) part.autoBackfilled += 1;
        else part.autoCompleted += 1;
        continue;
      }

      if (instance.overdueMarkedAt === null) {
        await prisma.$transaction([
          prisma.observationTaskInstance.update({
            where: { id: instance.id },
            data: { overdueMarkedAt: now },
          }),
          prisma.observationTaskEvent.create({
            data: {
              taskId: task.id,
              instanceId: instance.id,
              type: "OVERDUE",
              detail: JSON.stringify({ windowEndDate: instance.windowEndDate, markedAt: today }),
            },
          }),
        ]);
        part.overdueMarked += 1;
      }
      continue;
    }

    // 窗口进行中且到达提醒日：每个实例只提醒一次。
    if (
      instance.remindedAt === null &&
      instance.reminderDate !== null &&
      instance.reminderDate <= today
    ) {
      await prisma.$transaction([
        prisma.observationTaskInstance.update({
          where: { id: instance.id },
          data: { remindedAt: now },
        }),
        prisma.observationTaskEvent.create({
          data: {
            taskId: task.id,
            instanceId: instance.id,
            type: "REMINDER_SENT",
            detail: JSON.stringify({ reminderDate: instance.reminderDate, sentOn: today }),
          },
        }),
      ]);
      part.remindersSent += 1;
    }
  }

  return part;
}

async function findMatchingObservation(
  task: TaskWithRelations,
  instance: { id: string; year: number; windowStartDate: string; windowEndDate: string },
) {
  // 窗口内按时记录优先；没有再找当年窗口结束之后的逾期补录记录。
  const withinWindow = await prisma.observation.findFirst({
    where: {
      ownerId: task.ownerId,
      siteId: task.siteId,
      speciesId: task.speciesId ?? null,
      phenophaseId: task.phenophaseId ?? null,
      kind: task.kind,
      status: "PUBLISHED",
      observationDate: { gte: instance.windowStartDate, lte: instance.windowEndDate },
      taskCompletions: { none: {} },
    },
    orderBy: { observationDate: "asc" },
    select: { id: true, observationDate: true },
  });
  if (withinWindow) return withinWindow;

  return prisma.observation.findFirst({
    where: {
      ownerId: task.ownerId,
      siteId: task.siteId,
      speciesId: task.speciesId ?? null,
      phenophaseId: task.phenophaseId ?? null,
      kind: task.kind,
      status: "PUBLISHED",
      observationDate: { gt: instance.windowEndDate, lte: `${instance.year}-12-31` },
      taskCompletions: { none: {} },
    },
    orderBy: { observationDate: "asc" },
    select: { id: true, observationDate: true },
  });
}

// ---------------------------------------------------------------------------
// 完成 / 补录 / 跳过 / 重开实例
// ---------------------------------------------------------------------------

async function getOwnedInstance(userId: string, instanceId: string) {
  const instance = await prisma.observationTaskInstance.findFirst({
    where: { id: instanceId, task: { ownerId: userId } },
    include: { task: true },
  });
  if (!instance) throw new ApiError(404, "NOT_FOUND", "待办不存在");
  return instance;
}

export async function completeInstance(userId: string, instanceId: string, input: CompleteInstanceInput, now = new Date()) {
  const instance = await getOwnedInstance(userId, instanceId);
  const task = await getOwnedTask(userId, instance.taskId);
  if (task.status === "CLOSED") throw conflict("TASK_CLOSED", "任务已关闭，无法登记完成");
  if (instance.status === "COMPLETED" || instance.status === "BACKFILLED") {
    throw conflict("INSTANCE_DONE", "该待办已完成，如需修改请先重新打开", {
      status: instance.status,
      observationId: instance.observationId,
    });
  }

  let observationDate: string;
  let observationId: string | null = null;

  if (input.observationId) {
    const observation = await getOwnedObservation(userId, input.observationId);
    if (observation.status !== "PUBLISHED") throw conflict("OBSERVATION_DRAFT", "草稿不能用于完成待办，请先发布");
    if (observation.siteId !== task.siteId || observation.kind !== task.kind) {
      throw validationError("observationId", "观测记录的地点或类型与任务不一致");
    }
    if ((task.speciesId ?? null) !== (observation.speciesId ?? null)) {
      throw validationError("observationId", "观测记录的物种与任务不一致");
    }
    if ((task.phenophaseId ?? null) !== (observation.phenophaseId ?? null)) {
      throw validationError("observationId", "观测记录的物候阶段与任务不一致");
    }
    const alreadyLinked = await prisma.observationTaskInstance.findFirst({
      where: { observationId: observation.id, id: { not: instanceId } },
      select: { id: true },
    });
    if (alreadyLinked) throw conflict("OBSERVATION_LINKED", "该观测记录已关联到其他待办");
    observationDate = observation.observationDate;
    observationId = observation.id;
  } else if (input.observationDate) {
    observationDate = input.observationDate;
  } else {
    throw validationError("observationId", "请提供要关联的观测记录，或直接补录观察日期");
  }

  const outside =
    observationDate < instance.windowStartDate || observationDate > `${instance.year}-12-31`;
  if (outside && !input.force) {
    throw conflict("DATE_OUTSIDE_WINDOW", "观察日期不在该待办的物候年份内，确认后可强制登记", {
      windowStartDate: instance.windowStartDate,
      yearEnd: `${instance.year}-12-31`,
      observationDate,
    });
  }

  const backfilled = observationDate > instance.windowEndDate;
  const daysLate = Math.max(0, daysBetween(instance.windowEndDate, observationDate));

  await prisma.$transaction([
    prisma.observationTaskInstance.update({
      where: { id: instanceId },
      data: {
        status: backfilled ? "BACKFILLED" : "COMPLETED",
        observationId,
        completedAt: now,
        completedDate: observationDate,
        completedDaysLate: daysLate,
        completionNote: input.note ?? null,
      },
    }),
    prisma.observationTaskEvent.create({
      data: {
        taskId: task.id,
        instanceId,
        type: backfilled ? "BACKFILLED" : "COMPLETED",
        detail: JSON.stringify({
          source: observationId ? "LINK_OBSERVATION" : "MANUAL_DATE",
          observationId,
          observationDate,
          daysLate,
          note: input.note ?? null,
        }),
      },
    }),
  ]);

  return getTask(userId, task.id, now);
}

export async function skipInstance(userId: string, instanceId: string, input: SkipInstanceInput, now = new Date()) {
  const instance = await getOwnedInstance(userId, instanceId);
  if (instance.status !== "PENDING") throw conflict("INSTANCE_NOT_PENDING", "只有待处理的待办可以跳过");
  await prisma.$transaction([
    prisma.observationTaskInstance.update({ where: { id: instanceId }, data: { status: "SKIPPED" } }),
    prisma.observationTaskEvent.create({
      data: {
        taskId: instance.taskId,
        instanceId,
        type: "SKIPPED",
        detail: JSON.stringify({ year: instance.year, reason: input.reason ?? null, at: now.toISOString() }),
      },
    }),
  ]);
  return getTask(userId, instance.taskId, now);
}

export async function reopenInstance(userId: string, instanceId: string, now = new Date()) {
  const instance = await getOwnedInstance(userId, instanceId);
  if (instance.status === "PENDING") throw conflict("INSTANCE_PENDING", "该待办本就处于待处理状态");
  await prisma.$transaction([
    prisma.observationTaskInstance.update({
      where: { id: instanceId },
      data: {
        status: "PENDING",
        observationId: null,
        completedAt: null,
        completedDate: null,
        completedDaysLate: null,
        completionNote: null,
        reopenedAt: now,
      },
    }),
    prisma.observationTaskEvent.create({
      data: {
        taskId: instance.taskId,
        instanceId,
        type: "REOPENED",
        detail: JSON.stringify({ previousStatus: instance.status, at: now.toISOString() }),
      },
    }),
  ]);
  return getTask(userId, instance.taskId, now);
}

import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "../lib/http";
import { prisma } from "../lib/prisma";
import { scanAllTasks } from "../modules/tasks/service";
import * as tasksService from "../modules/tasks/service";
import { auth, createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";

// 固定的 UTC 时刻，按 Asia/Shanghai 换算后分别对应窗口前、窗口中、窗口后等场景。
const TZ = "Asia/Shanghai";
const BEFORE_WINDOW = new Date("2026-03-01T02:00:00Z"); // 北京 03-01 10:00
const IN_WINDOW = new Date("2026-03-12T02:00:00Z"); // 北京 03-12 10:00
const AFTER_WINDOW = new Date("2026-04-05T02:00:00Z"); // 北京 04-05 10:00

async function makeTask(
  userId: string,
  siteId: string,
  overrides: {
    speciesId?: string | null;
    phenophaseId?: string | null;
    kind?: "PLANT_PHENOLOGY" | "INSECT_SIGHTING" | "BIRD_SOUND" | "WEATHER_ANOMALY";
    windowStart?: string;
    windowEnd?: string;
    reminderDays?: number;
    timezone?: string;
    title?: string;
  } = {},
  now = BEFORE_WINDOW,
) {
  return tasksService.createTask(
    userId,
    {
      title: overrides.title ?? "银杏发芽巡查",
      siteId,
      speciesId: overrides.speciesId === undefined ? null : overrides.speciesId,
      phenophaseId: overrides.phenophaseId === undefined ? null : overrides.phenophaseId,
      kind: overrides.kind ?? "PLANT_PHENOLOGY",
      windowStart: overrides.windowStart ?? "03-05",
      windowEnd: overrides.windowEnd ?? "03-25",
      timezone: overrides.timezone ?? TZ,
      reminderDays: overrides.reminderDays ?? 0,
    },
    now,
  );
}

describe("观察任务：物候窗口与时区生成", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("创建任务时按当前时区年份生成上一年/今年/下一年三条待办，且重复扫描不产生两条", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const created = await makeTask(user.id, site.id, {}, BEFORE_WINDOW);

    const years = created.instances.map((item) => item.year);
    expect(years).toEqual([2025, 2026, 2027]);
    const current = created.instances.find((item) => item.year === 2026)!;
    expect(current.windowStartDate).toBe("2026-03-05");
    expect(current.windowEndDate).toBe("2026-03-25");
    expect(created.instances.every((item) => item.status === "PENDING")).toBe(true);

    // 再扫两次：数据库层面与返回结果都不应出现重复实例。
    const first = await scanAllTasks(BEFORE_WINDOW);
    const second = await scanAllTasks(BEFORE_WINDOW);
    expect(first.instancesCreated).toBe(0);
    expect(second.instancesCreated).toBe(0);

    const rawCount = await prisma.observationTaskInstance.count({ where: { taskId: created.id } });
    expect(rawCount).toBe(3);

    const events = await prisma.observationTaskEvent.findMany({ where: { taskId: created.id } });
    expect(events.some((event) => event.type === "CREATED")).toBe(true);
  });

  it("同一用户任务名唯一", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    await makeTask(user.id, site.id, { title: "同名任务" });
    await expect(makeTask(user.id, site.id, { title: "同名任务" })).rejects.toThrow();
  });

  it("时区影响生成的年份：UTC 年末在东八区已是次年", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);

    const shanghai = await makeTask(user.id, site.id, { timezone: "Asia/Shanghai" }, new Date("2026-12-31T17:00:00Z"));
    expect(shanghai.instances.map((item) => item.year)).toEqual([2026, 2027, 2028]);

    const otherSite = await createSite(user.id, "第二个观察点");
    const utc = await makeTask(user.id, otherSite.id, { timezone: "UTC", title: "UTC 任务" }, new Date("2026-12-31T17:00:00Z"));
    expect(utc.instances.map((item) => item.year)).toEqual([2025, 2026, 2027]);
  });

  it("非法时区与反向窗口被拒绝", async () => {
    const user = await registerUser();
    await expect(
      makeTask(user.id, "x", { timezone: "Asia/NotACity" }),
    ).rejects.toThrow();
  });
});

describe("观察任务：提醒", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("到达提醒日发送且仅发送一次提醒，重复扫描只保留一条历史", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    // 北京 02-20 创建：提醒日 02-26 尚未到达，创建时不发提醒
    const createdAt = new Date("2026-02-20T02:00:00Z");
    const created = await makeTask(user.id, site.id, { reminderDays: 7 }, createdAt);
    const current = created.instances.find((item) => item.year === 2026)!;

    // 03-01 扫描时已过提醒日，应发提醒
    const result = await scanAllTasks(BEFORE_WINDOW);
    expect(result.remindersSent).toBe(1);

    const again = await scanAllTasks(BEFORE_WINDOW);
    expect(again.remindersSent).toBe(0);

    const stored = await prisma.observationTaskInstance.findUniqueOrThrow({ where: { id: current.id } });
    expect(stored.remindedAt).not.toBeNull();

    const events = await prisma.observationTaskEvent.findMany({
      where: { instanceId: current.id, type: "REMINDER_SENT" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("观察任务：逾期与补录", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("窗口结束仍未完成时标记逾期，重复扫描不重复标记，事件留痕", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const created = await makeTask(user.id, site.id, {}, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    const overdue = await scanAllTasks(AFTER_WINDOW);
    expect(overdue.overdueMarked).toBe(1);
    const duplicate = await scanAllTasks(AFTER_WINDOW);
    expect(duplicate.overdueMarked).toBe(0);

    const events = await prisma.observationTaskEvent.findMany({
      where: { instanceId: current.id, type: "OVERDUE" },
    });
    expect(events).toHaveLength(1);

    const detail = await tasksService.getTask(user.id, created.id, AFTER_WINDOW);
    // 2025 与 2026 两个年度实例此时都已过窗口
    expect(detail.summary.overdue).toBe(2);
  });

  it("扫描时自动匹配窗口内已登记观测，按按时完成处理", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);
    const created = await makeTask(user.id, site.id, { speciesId, phenophaseId }, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    await prisma.observation.create({
      data: {
        ownerId: user.id,
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        status: "PUBLISHED",
        observationDate: "2026-03-10",
      },
    });

    const result = await scanAllTasks(AFTER_WINDOW);
    expect(result.autoCompleted).toBe(1);
    expect(result.autoBackfilled).toBe(0);

    const stored = await prisma.observationTaskInstance.findUniqueOrThrow({ where: { id: current.id } });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.completedDaysLate).toBe(0);
  });

  it("扫描时匹配到窗口结束后的记录，按逾期补录处理并记录逾期天数", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);
    const created = await makeTask(user.id, site.id, { speciesId, phenophaseId }, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    await prisma.observation.create({
      data: {
        ownerId: user.id,
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        status: "PUBLISHED",
        observationDate: "2026-03-30",
      },
    });

    const result = await scanAllTasks(AFTER_WINDOW);
    expect(result.autoBackfilled).toBe(1);

    const stored = await prisma.observationTaskInstance.findUniqueOrThrow({ where: { id: current.id } });
    expect(stored.status).toBe("BACKFILLED");
    expect(stored.completedDaysLate).toBe(5);

    const events = await prisma.observationTaskEvent.findMany({ where: { instanceId: current.id } });
    expect(events.some((event) => event.type === "BACKFILLED")).toBe(true);
  });

  it("手动关联窗口内观测为完成；窗口结束后补录为 BACKFILLED", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);
    const created = await makeTask(user.id, site.id, { speciesId, phenophaseId }, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    const onTime = await prisma.observation.create({
      data: {
        ownerId: user.id,
        siteId: site.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        status: "PUBLISHED",
        observationDate: "2026-03-20",
      },
    });
    await tasksService.completeInstance(user.id, current.id, { observationId: onTime.id }, IN_WINDOW);
    let stored = await prisma.observationTaskInstance.findUniqueOrThrow({ where: { id: current.id } });
    expect(stored.status).toBe("COMPLETED");
    expect(stored.completedDaysLate).toBe(0);

    // 重开后再用窗口后的日期补录
    await tasksService.reopenInstance(user.id, current.id, IN_WINDOW);
    await tasksService.completeInstance(user.id, current.id, { observationDate: "2026-04-01" }, AFTER_WINDOW);
    stored = await prisma.observationTaskInstance.findUniqueOrThrow({ where: { id: current.id } });
    expect(stored.status).toBe("BACKFILLED");
    expect(stored.completedDaysLate).toBe(7);

    const eventTypes = (
      await prisma.observationTaskEvent.findMany({ where: { instanceId: current.id }, orderBy: { createdAt: "asc" } })
    ).map((event) => event.type);
    expect(eventTypes).toEqual(["COMPLETED", "REOPENED", "BACKFILLED"]);
  });

  it("已完成待办重复完成返回 409", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const created = await makeTask(user.id, site.id, {}, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    await tasksService.completeInstance(user.id, current.id, { observationDate: "2026-03-10" }, IN_WINDOW);
    await expect(
      tasksService.completeInstance(user.id, current.id, { observationDate: "2026-03-11" }, IN_WINDOW),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("关联物种/地点不一致的观测会被拒绝；一条观测不能关联两条待办", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const otherSite = await createSite(user.id, "另一个点");
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);
    const taskA = await makeTask(user.id, site.id, { speciesId, phenophaseId, title: "任务甲" }, BEFORE_WINDOW);
    const taskB = await makeTask(user.id, otherSite.id, { speciesId, phenophaseId, title: "任务乙" }, BEFORE_WINDOW);
    const instA = taskA.instances.find((item) => item.year === 2026)!;
    const instB = taskB.instances.find((item) => item.year === 2026)!;

    const obsB = await prisma.observation.create({
      data: {
        ownerId: user.id,
        siteId: otherSite.id,
        speciesId,
        phenophaseId,
        kind: "PLANT_PHENOLOGY",
        status: "PUBLISHED",
        observationDate: "2026-03-10",
      },
    });
    await expect(
      tasksService.completeInstance(user.id, instA.id, { observationId: obsB.id }, IN_WINDOW),
    ).rejects.toBeInstanceOf(ApiError);

    await tasksService.completeInstance(user.id, instB.id, { observationId: obsB.id }, IN_WINDOW);
    await expect(
      tasksService.completeInstance(user.id, instA.id, { observationId: obsB.id }, IN_WINDOW),
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe("观察任务：跳过、关闭与历史", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("跳过、关闭、重开均产生事件；关闭后不再被扫描", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const created = await makeTask(user.id, site.id, {}, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    await tasksService.skipInstance(user.id, current.id, { reason: "今年没去" }, IN_WINDOW);
    // 跳过后即使窗口结束扫描也不会自动标记逾期或补录
    const afterSkip = await scanAllTasks(AFTER_WINDOW);
    expect(afterSkip.overdueMarked).toBe(0);
    expect(afterSkip.autoCompleted).toBe(0);

    await tasksService.closeTask(user.id, created.id);
    const closedScan = await scanAllTasks(AFTER_WINDOW);
    expect(closedScan.tasksScanned).toBe(0);

    await tasksService.reopenTask(user.id, created.id, AFTER_WINDOW);
    const events = await tasksService.listEvents(user.id, created.id);
    const types = events.map((event) => event.type);
    expect(types).toContain("SKIPPED");
    expect(types).toContain("CLOSED");
    expect(types).toContain("REOPENED");
  });

  it("关闭后无法登记完成，重开任务后可以继续操作", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const created = await makeTask(user.id, site.id, {}, BEFORE_WINDOW);
    const current = created.instances.find((item) => item.year === 2026)!;

    await tasksService.closeTask(user.id, created.id);
    await expect(
      tasksService.completeInstance(user.id, current.id, { observationDate: "2026-03-10" }, IN_WINDOW),
    ).rejects.toBeInstanceOf(ApiError);

    await tasksService.reopenTask(user.id, created.id, BEFORE_WINDOW);
    const result = await tasksService.completeInstance(
      user.id,
      current.id,
      { observationDate: "2026-03-10" },
      IN_WINDOW,
    );
    expect(result.summary.completed).toBe(1);
  });

  it("修改窗口后未完成实例日期被就地校正，历史实例不被删除", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const created = await makeTask(user.id, site.id, {}, BEFORE_WINDOW);

    await tasksService.updateTask(user.id, created.id, { windowStart: "04-01", windowEnd: "04-20" }, BEFORE_WINDOW);
    const updated = await tasksService.getTask(user.id, created.id, BEFORE_WINDOW);
    const current = updated.instances.find((item) => item.year === 2026)!;
    expect(current.windowStartDate).toBe("2026-04-01");
    expect(current.windowEndDate).toBe("2026-04-20");
    expect(updated.instances).toHaveLength(3);

    const events = await tasksService.listEvents(user.id, created.id);
    expect(events.some((event) => event.type === "UPDATED")).toBe(true);
  });
});

describe("观察任务 HTTP 接口", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("完整走一遍：建任务 → 扫描 → 补录完成 → 查历史 → 关闭", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);

    const createRes = await user.agent
      .post("/api/v1/tasks")
      .set(auth(user.accessToken))
      .send({
        title: "接口任务",
        siteId: site.id,
        kind: "PLANT_PHENOLOGY",
        windowStart: "03-05",
        windowEnd: "03-25",
        timezone: "Asia/Shanghai",
        reminderDays: 3,
      });
    expect(createRes.status).toBe(201);
    const taskId = createRes.body.data.id as string;
    expect(createRes.body.data.instances).toHaveLength(3);

    const scanRes = await user.agent.post("/api/v1/tasks/scan").set(auth(user.accessToken)).send();
    expect(scanRes.status).toBe(200);
    expect(scanRes.body.data.tasksScanned).toBe(1);

    const listRes = await user.agent.get("/api/v1/tasks").set(auth(user.accessToken));
    expect(listRes.body.data).toHaveLength(1);

    const instance = createRes.body.data.instances.find((item: { year: number }) => item.year === 2026);
    const completeRes = await user.agent
      .post(`/api/v1/tasks/instances/${instance.id}/complete`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2026-04-02" });
    expect(completeRes.status).toBe(200);
    const backfilled = completeRes.body.data.instances.find((item: { year: number }) => item.year === 2026);
    expect(backfilled.status).toBe("BACKFILLED");
    expect(backfilled.completedDaysLate).toBe(8);

    const eventsRes = await user.agent.get(`/api/v1/tasks/${taskId}/events`).set(auth(user.accessToken));
    expect(eventsRes.body.data.some((event: { type: string }) => event.type === "BACKFILLED")).toBe(true);

    const closeRes = await user.agent.delete(`/api/v1/tasks/${taskId}`).set(auth(user.accessToken));
    expect(closeRes.status).toBe(200);

    const closedRes = await user.agent
      .get("/api/v1/tasks?status=CLOSED")
      .set(auth(user.accessToken));
    expect(closedRes.body.data).toHaveLength(1);
    // 关闭后实例与历史仍在
    const detailRes = await user.agent.get(`/api/v1/tasks/${taskId}`).set(auth(user.accessToken));
    expect(detailRes.body.data.instances).toHaveLength(3);
    expect(detailRes.body.data.eventCount).toBeGreaterThanOrEqual(3);
  });

  it("窗口起止倒置返回 400", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const res = await user.agent
      .post("/api/v1/tasks")
      .set(auth(user.accessToken))
      .send({
        title: "坏窗口",
        siteId: site.id,
        kind: "PLANT_PHENOLOGY",
        windowStart: "12-01",
        windowEnd: "01-01",
      });
    expect(res.status).toBe(400);
  });

  it("不能读取他人任务", async () => {
    const alice = await registerUser();
    const bob = await registerUser();
    const site = await createSite(alice.id);
    const created = await makeTask(alice.id, site.id, { title: "爱丽丝的任务" });

    const res = await bob.agent.get(`/api/v1/tasks/${created.id}`).set(auth(bob.accessToken));
    expect(res.status).toBe(404);
  });
});

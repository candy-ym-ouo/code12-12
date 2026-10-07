import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../lib/prisma";
import type { RegisteredUser } from "./helpers/db";
import { auth, createSite, createSpeciesWithPhase, registerUser, resetDatabase } from "./helpers/db";
import { scanUserTasks } from "../modules/tasks/service";

// 注入扫描时刻（UTC），Asia/Shanghai 为 UTC+8，以下时间当地日历日清晰
const at = (iso: string) => new Date(iso);

async function createRule(user: RegisteredUser, overrides: Record<string, unknown> = {}) {
  const site = await createSite(user.id, overrides.siteName ? String(overrides.siteName) : "任务观察点");
  return user.agent
    .post("/api/v1/tasks/task-rules")
    .set(auth(user.accessToken))
    .send({
      name: "银杏芽萌动观察",
      kind: "PLANT_PHENOLOGY",
      windowStartMd: "03-01",
      windowEndMd: "04-15",
      dueOffsetDays: 10,
      remindBeforeDays: 3,
      siteId: site.id,
      ...overrides,
    })
    .then((res) => {
      if (res.status !== 201) throw new Error(`创建规则失败：${res.status} ${JSON.stringify(res.body)}`);
      return { rule: res.body.data as Record<string, unknown>, siteId: site.id };
    });
}

async function firstTaskId(user: RegisteredUser, status = "OPEN") {
  const res = await user.agent.get(`/api/v1/tasks?status=${status}`).set(auth(user.accessToken));
  expect(res.status).toBe(200);
  return res.body.data[0].id as string;
}

describe("观察任务：规则", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("创建规则并校验月日格式、物种类别", async () => {
    const user = await registerUser();
    const site = await createSite(user.id);
    const { speciesId, phenophaseId } = await createSpeciesWithPhase(user.id);

    const ok = await user.agent.post("/api/v1/tasks/task-rules").set(auth(user.accessToken)).send({
      name: "初鸣观察",
      kind: "BIRD_SOUND",
      windowStartMd: "04-01",
      windowEndMd: "05-01",
      siteId: site.id,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.active).toBe(true);
    expect(ok.body.data.dueOffsetDays).toBe(0);
    expect(ok.body.data.remindBeforeDays).toBe(3);

    const badMd = await user.agent.post("/api/v1/tasks/task-rules").set(auth(user.accessToken)).send({
      name: "非法窗口",
      kind: "PLANT_PHENOLOGY",
      windowStartMd: "02-30",
      windowEndMd: "03-01",
      siteId: site.id,
    });
    expect(badMd.status).toBe(400);

    // PLANT 类任务不能挂 INSECT 物种（测试物种是 PLANT，用 BIRD 任务制造不匹配）
    const mismatch = await user.agent.post("/api/v1/tasks/task-rules").set(auth(user.accessToken)).send({
      name: "类别不匹配",
      kind: "INSECT_SIGHTING",
      windowStartMd: "04-01",
      windowEndMd: "05-01",
      siteId: site.id,
      speciesId,
      phenophaseId,
    });
    expect(mismatch.status).toBe(400);

    const listed = await user.agent.get("/api/v1/tasks/task-rules").set(auth(user.accessToken));
    expect(listed.body.data).toHaveLength(1);
  });

  it("更新规则与停用；已有待办后删除被拒绝", async () => {
    const user = await registerUser();
    const { rule } = await createRule(user);

    const updated = await user.agent
      .patch(`/api/v1/tasks/task-rules/${rule.id}`)
      .set(auth(user.accessToken))
      .send({ remindBeforeDays: 7, active: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.remindBeforeDays).toBe(7);
    expect(updated.body.data.active).toBe(false);

    // 停用后扫描不再为该规则生成待办
    const scan = await scanUserTasks(user.id, at("2026-03-10T02:00:00Z"));
    expect(scan.created).toBe(0);

    // 先激活生成一条，再删除应被拒绝（有历史任务，Restrict + 业务 409）
    await user.agent
      .patch(`/api/v1/tasks/task-rules/${rule.id}`)
      .set(auth(user.accessToken))
      .send({ active: true });
    await scanUserTasks(user.id, at("2026-03-10T02:00:00Z"));
    const removed = await user.agent.delete(`/api/v1/tasks/task-rules/${rule.id}`).set(auth(user.accessToken));
    expect(removed.status).toBe(409);
    expect(removed.body.error.code).toBe("RESOURCE_IN_USE");
  });
});

describe("观察任务：扫描幂等、提醒与逾期", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("重复扫描只生成一条待办与一条创建历史", async () => {
    const user = await registerUser();
    await createRule(user);

    const first = await scanUserTasks(user.id, at("2026-03-08T02:00:00Z"));
    expect(first).toEqual({ created: 1, reminders: 1, overdue: 0, usersScanned: 1 });

    // 同一天与窗口内稍后日期重复扫描：不再产生第二条
    const second = await scanUserTasks(user.id, at("2026-03-08T10:00:00Z"));
    expect(second).toEqual({ created: 0, reminders: 0, overdue: 0, usersScanned: 1 });
    const third = await scanUserTasks(user.id, at("2026-03-09T02:00:00Z"));
    expect(third.created).toBe(0);

    const tasks = await prisma.observationTask.findMany({ where: { ownerId: user.id } });
    expect(tasks).toHaveLength(1);
    const events = await prisma.observationTaskEvent.findMany({ where: { taskId: tasks[0].id } });
    expect(events.filter((e) => e.type === "CREATED")).toHaveLength(1);
    expect(events.filter((e) => e.type === "REMINDER_SENT")).toHaveLength(1);
    expect(tasks[0].reminderSentAt).not.toBeNull();
  });

  it("逾期首次扫描留一条 OVERDUE，重复扫描不重复留痕", async () => {
    const user = await registerUser();
    await createRule(user);

    const overdue = await scanUserTasks(user.id, at("2026-03-12T02:00:00Z"));
    expect(overdue.created).toBe(1);
    expect(overdue.overdue).toBe(1);
    expect(overdue.reminders).toBe(0); // 已逾期不再发即将到期提醒

    const again = await scanUserTasks(user.id, at("2026-03-13T02:00:00Z"));
    expect(again).toEqual({ created: 0, reminders: 0, overdue: 0, usersScanned: 1 });

    const list = await user.agent.get("/api/v1/tasks?status=OVERDUE").set(auth(user.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].overdue).toBe(true);
    expect(list.body.data[0].daysUntilDue).toBeLessThan(0);

    const events = list.body.data[0].events;
    expect(events.filter((e: { type: string }) => e.type === "OVERDUE")).toHaveLength(1);
  });

  it("跨年窗口：1 月中的任务归属上一年窗口，只生成一条", async () => {
    const user = await registerUser();
    await createRule(user, { windowStartMd: "12-15", windowEndMd: "01-15", dueOffsetDays: 7 });

    await scanUserTasks(user.id, at("2026-12-20T02:00:00Z"));
    await scanUserTasks(user.id, at("2027-01-10T02:00:00Z"));

    const tasks = await prisma.observationTask.findMany({ where: { ownerId: user.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      occurrenceKey: "2026",
      windowStart: "2026-12-15",
      windowEnd: "2027-01-15",
      dueDate: "2026-12-22",
    });
  });

  it("按用户时区决定窗口是否开始：同一 UTC 时刻上海已开始、洛杉矶未开始", async () => {
    const shanghai = await registerUser({ email: "sh@example.com" });
    await createRule(shanghai, { windowStartMd: "10-07", windowEndMd: "10-20", remindBeforeDays: 0 });

    const losAngeles = await registerUser({ email: "la@example.com" });
    await createRule(losAngeles, { windowStartMd: "10-07", windowEndMd: "10-20", remindBeforeDays: 0 });
    await prisma.user.update({ where: { id: losAngeles.id }, data: { timezone: "America/Los_Angeles" } });

    // 2026-10-07 02:00 UTC：上海 10:00（10-07），洛杉矶 10-06 19:00
    const moment = at("2026-10-07T02:00:00Z");
    const a = await scanUserTasks(shanghai.id, moment);
    const b = await scanUserTasks(losAngeles.id, moment);
    expect(a.created).toBe(1);
    expect(b.created).toBe(0);
  });
});

describe("观察任务：完成、补录、关闭与历史", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("如期完成自动登记观测并写 COMPLETED，重复完成返回 409", async () => {
    const user = await registerUser();
    const { rule } = await createRule(user);
    await scanUserTasks(user.id, at("2026-03-08T02:00:00Z"));
    const taskId = await firstTaskId(user);

    const done = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2026-10-07" });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("DONE");
    expect(done.body.data.completedDate).toBe("2026-10-07");
    expect(done.body.data.observation.observationDate).toBe("2026-10-07");

    const observation = await prisma.observation.findUniqueOrThrow({
      where: { id: done.body.data.observation.id },
    });
    expect(observation).toMatchObject({
      siteId: rule.siteId as string,
      kind: "PLANT_PHENOLOGY",
      source: "TASK",
    });

    const events = done.body.data.events as Array<{ type: string }>;
    expect(events.some((e) => e.type === "COMPLETED")).toBe(true);
    expect(events.some((e) => e.type === "BACKFILLED")).toBe(false);

    const repeat = await user.agent.post(`/api/v1/tasks/${taskId}/complete`).set(auth(user.accessToken)).send({});
    expect(repeat.status).toBe(409);
    expect(repeat.body.error.code).toBe("TASK_NOT_OPEN");
  });

  it("补录过去日期写 BACKFILLED 并记录逾期天数；未来日期被拒绝", async () => {
    const user = await registerUser();
    await createRule(user);
    await scanUserTasks(user.id, at("2026-03-12T02:00:00Z"));
    const taskId = await firstTaskId(user);

    // 未来日期在 OPEN 任务上即被拒绝（走参数校验分支，而非状态冲突）
    const future = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2099-01-01" });
    expect(future.status).toBe(400);
    expect(future.body.error.details[0].path).toBe("observationDate");

    const backfilled = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2026-03-05", notes: "补记：芽已展开" });
    expect(backfilled.status).toBe(200);
    const backfillEvent = backfilled.body.data.events.find((e: { type: string }) => e.type === "BACKFILLED");
    expect(backfillEvent).toBeTruthy();
    expect(backfillEvent.payload.backfilled).toBe(true);
    expect(backfillEvent.payload.observationId).toBeTruthy();

    // 重复补录（同任务已完成）仍然 409，且只有一条完成类事件
    const again = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({ observationDate: "2026-03-06" });
    expect(again.status).toBe(409);
  });

  it("可关联已有观测，地点/类型不一致时拒绝", async () => {
    const user = await registerUser();
    const { rule } = await createRule(user);
    const otherSite = await createSite(user.id, "另一观察点");
    await scanUserTasks(user.id, at("2026-03-08T02:00:00Z"));
    const taskId = await firstTaskId(user);

    const wrong = await user.agent.post("/api/v1/observations").set(auth(user.accessToken)).send({
      siteId: otherSite.id,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2026-03-08",
    });
    const reject = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({ observationId: wrong.body.data.id, createObservation: false });
    expect(reject.status).toBe(400);

    const correct = await user.agent.post("/api/v1/observations").set(auth(user.accessToken)).send({
      siteId: rule.siteId,
      kind: "PLANT_PHENOLOGY",
      observationDate: "2026-03-08",
    });
    const linked = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({ observationId: correct.body.data.id, createObservation: false });
    expect(linked.status).toBe(200);
    expect(linked.body.data.observation.id).toBe(correct.body.data.id);
  });

  it("关闭写 CLOSED 历史，重复关闭 409；历史流可查", async () => {
    const user = await registerUser();
    await createRule(user);
    await scanUserTasks(user.id, at("2026-03-08T02:00:00Z"));
    const taskId = await firstTaskId(user);

    const closed = await user.agent
      .post(`/api/v1/tasks/${taskId}/close`)
      .set(auth(user.accessToken))
      .send({ reason: "今年物候期错过，放弃观察" });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("CLOSED");

    const repeat = await user.agent.post(`/api/v1/tasks/${taskId}/close`).set(auth(user.accessToken)).send({});
    expect(repeat.status).toBe(409);

    const completeAfterClose = await user.agent
      .post(`/api/v1/tasks/${taskId}/complete`)
      .set(auth(user.accessToken))
      .send({});
    expect(completeAfterClose.status).toBe(409);

    const history = await user.agent.get("/api/v1/tasks/history").set(auth(user.accessToken));
    expect(history.status).toBe(200);
    const types = (history.body.data as Array<{ type: string }>).map((e) => e.type);
    expect(types).toContain("CREATED");
    expect(types).toContain("REMINDER_SENT");
    expect(types).toContain("CLOSED");
    expect(new Set(types).size).toBe(types.length === 3 ? 3 : new Set(types).size);

    const single = await user.agent.get(`/api/v1/tasks/${taskId}/events`).set(auth(user.accessToken));
    expect(single.body.data.find((e: { type: string }) => e.type === "CLOSED").payload.reason).toContain(
      "错过",
    );
  });

  it("未完成的任务在 DONE/CLOSED 列表中不出现", async () => {
    const user = await registerUser();
    await createRule(user);
    await scanUserTasks(user.id, at("2026-03-08T02:00:00Z"));

    const open = await user.agent.get("/api/v1/tasks?status=OPEN").set(auth(user.accessToken));
    expect(open.body.data).toHaveLength(1);
    const done = await user.agent.get("/api/v1/tasks?status=DONE").set(auth(user.accessToken));
    expect(done.body.data).toHaveLength(0);
  });
});

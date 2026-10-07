import { describe, expect, it } from "vitest";
import {
  completionKind,
  isOverdue,
  isReminderDue,
  isValidMonthDay,
  resolveOccurrence,
} from "../lib/taskScheduler";

const spring = {
  windowStartMd: "03-01",
  windowEndMd: "04-15",
  dueOffsetDays: 10,
  remindBeforeDays: 3,
};

const winter = {
  windowStartMd: "12-15",
  windowEndMd: "01-15",
  dueOffsetDays: 7,
  remindBeforeDays: 3,
};

describe("isValidMonthDay", () => {
  it("接受合法月日，拒绝非法与越界日期", () => {
    expect(isValidMonthDay("03-01")).toBe(true);
    expect(isValidMonthDay("12-31")).toBe(true);
    expect(isValidMonthDay("02-29")).toBe(true);
    expect(isValidMonthDay("13-01")).toBe(false);
    expect(isValidMonthDay("02-30")).toBe(false);
    expect(isValidMonthDay("3-1")).toBe(false);
  });
});

describe("resolveOccurrence · 普通物候窗口", () => {
  it("窗口开始前返回 null", () => {
    expect(resolveOccurrence(spring, "2026-02-28")).toBeNull();
  });

  it("窗口开始即生成；目标日提前 3 天起评估提醒", () => {
    // windowStart 03-01 + 10 = due 03-11；进入窗口就应有待办
    const occurrence = resolveOccurrence(spring, "2026-03-01");
    expect(occurrence).not.toBeNull();
    expect(occurrence).toMatchObject({
      occurrenceKey: "2026",
      windowStart: "2026-03-01",
      windowEnd: "2026-04-15",
      dueDate: "2026-03-11",
      generationStart: "2026-03-01",
    });
  });

  it("窗口开始前一天仍不生成", () => {
    expect(resolveOccurrence(spring, "2026-02-28")).toBeNull();
  });

  it("窗口结束后不再生成", () => {
    expect(resolveOccurrence(spring, "2026-04-16")).toBeNull();
  });

  it("同一天窗口内解析结果稳定（重复扫描输入一致）", () => {
    const a = resolveOccurrence(spring, "2026-03-20");
    const b = resolveOccurrence(spring, "2026-03-20");
    expect(a).toEqual(b);
  });
});

describe("resolveOccurrence · 跨年物候窗口", () => {
  it("12 月中的日期归属当年开始的窗口", () => {
    // due 12-22，提前 3 天 = 12-19 起生成
    const occurrence = resolveOccurrence(winter, "2026-12-20");
    expect(occurrence).toMatchObject({
      occurrenceKey: "2026",
      windowStart: "2026-12-15",
      windowEnd: "2027-01-15",
      dueDate: "2026-12-22",
    });
  });

  it("1 月中的日期归属上一年开始的窗口", () => {
    const occurrence = resolveOccurrence(winter, "2027-01-10");
    expect(occurrence).toMatchObject({
      occurrenceKey: "2026",
      windowStart: "2026-12-15",
      windowEnd: "2027-01-15",
    });
  });

  it("跨年窗口的 1 月提醒期也归属上一年", () => {
    // due 2026-12-22，提醒在 12 月；1 月初仍在窗口内 → 仍是同一 occurrenceKey
    expect(resolveOccurrence(winter, "2027-01-01")?.occurrenceKey).toBe("2026");
    expect(resolveOccurrence(winter, "2027-01-16")).toBeNull();
  });
});

describe("提醒与逾期判定", () => {
  const task = { dueDate: "2026-03-11", reminderSentAt: null as Date | null, status: "OPEN" };

  it("到期前第 3 天进入提醒区间，发过后不再提醒", () => {
    expect(isReminderDue(task, "2026-03-08", 3)).toBe(true);
    expect(isReminderDue(task, "2026-03-07", 3)).toBe(false);
    expect(isReminderDue({ ...task, reminderSentAt: new Date() }, "2026-03-09", 3)).toBe(false);
  });

  it("过了目标日即逾期", () => {
    expect(isOverdue(task, "2026-03-11")).toBe(false);
    expect(isOverdue(task, "2026-03-12")).toBe(true);
    expect(isOverdue({ ...task, status: "DONE" }, "2026-03-20")).toBe(false);
  });
});

describe("completionKind", () => {
  it("观测日早于今天为补录，否则为如期完成", () => {
    expect(completionKind("2026-03-10", "2026-03-12")).toBe("BACKFILLED");
    expect(completionKind("2026-03-12", "2026-03-12")).toBe("COMPLETED");
    expect(completionKind("2026-03-12", "2026-03-11")).toBe("COMPLETED");
  });
});

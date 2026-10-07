import { addDays, daysBetween, isValidDateString, parseDateString } from "./date";

export const MONTH_DAY_PATTERN = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidMonthDay(value: string): boolean {
  if (!MONTH_DAY_PATTERN.test(value)) return false;
  const [month, day] = value.split("-").map(Number);
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= maxDay;
}

export type RuleWindowInput = {
  windowStartMd: string;
  windowEndMd: string;
  dueOffsetDays: number;
  remindBeforeDays: number;
};

export type Occurrence = {
  /** 窗口起始日所在年份；跨年窗口以此唯一标识一次物候期 */
  occurrenceKey: string;
  windowStart: string;
  windowEnd: string;
  dueDate: string;
  /** 到达该日期即应生成待办（窗口起点或提醒起点，取更早者） */
  generationStart: string;
};

function monthDayInYear(md: string, year: number): string {
  const [month, day] = md.split("-").map(Number);
  const date = `${year}-${md}`;
  if (isValidDateString(date)) return date;
  // 非闰年的 02-29 归一到 02-28（与序日参照系一致）
  if (month === 2 && day === 29) return `${year}-02-28`;
  throw new Error(`非法月日：${md}`);
}

/**
 * 判断 today（站点当地日历日）落在规则的哪一次窗口中。
 * - 非跨年窗口（startMd <= endMd）：同年 MM-DD ~ MM-DD。
 * - 跨年窗口（startMd > endMd，如 12-15 ~ 01-15）：1 月中的日期属于上一年开始的窗口。
 * 返回 null 表示今天既不在窗口内，也还没到提前生成（提醒）的时点。
 */
export function resolveOccurrence(rule: RuleWindowInput, today: string): Occurrence | null {
  const parsed = parseDateString(today);
  if (!parsed) throw new Error(`非法日期字符串：${today}`);

  const startYearCandidate = parsed.year;
  const build = (startYear: number): Occurrence => {
    const windowStart = monthDayInYear(rule.windowStartMd, startYear);
    const crossYear = rule.windowStartMd > rule.windowEndMd;
    const windowEnd = monthDayInYear(rule.windowEndMd, crossYear ? startYear + 1 : startYear);
    const dueDate = addDays(windowStart, rule.dueOffsetDays);
    const reminderStart = addDays(dueDate, -rule.remindBeforeDays);
    // 进入窗口即生成待办；若负向 dueOffsetDays 使提醒日早于窗口起点，则取更早者
    const generationStart =
      daysBetween(reminderStart, windowStart) > 0 ? reminderStart : windowStart;
    return { occurrenceKey: String(startYear), windowStart, windowEnd, dueDate, generationStart };
  };

  // 先试"今年开始"的窗口；跨年时再试"去年开始"的窗口。
  const thisYear = build(startYearCandidate);
  if (today >= thisYear.generationStart && today <= thisYear.windowEnd) return thisYear;

  if (rule.windowStartMd > rule.windowEndMd) {
    const lastYear = build(startYearCandidate - 1);
    if (today >= lastYear.generationStart && today <= lastYear.windowEnd) return lastYear;
  }

  return null;
}

/** 是否进入提醒区间：到达（dueDate - remindBeforeDays）当天起，且尚未发过提醒。 */
export function isReminderDue(
  task: { dueDate: string; reminderSentAt: Date | null },
  today: string,
  remindBeforeDays: number,
): boolean {
  if (task.reminderSentAt !== null) return false;
  const reminderStart = addDays(task.dueDate, -remindBeforeDays);
  return today >= reminderStart;
}

/** 是否已逾期：仍未完成且今天已过目标日。 */
export function isOverdue(task: { dueDate: string; status: string }, today: string): boolean {
  return task.status === "OPEN" && today > task.dueDate;
}

export function daysUntilDue(dueDate: string, today: string): number {
  return daysBetween(today, dueDate);
}

/** 完成日期属于"补录"还是"如期完成"：观测日早于今天即补录。 */
export function completionKind(observationDate: string, today: string): "COMPLETED" | "BACKFILLED" {
  return observationDate < today ? "BACKFILLED" : "COMPLETED";
}

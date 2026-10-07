import { addDays, parseDateString, todayInTimezone } from "./date";

const MONTH_DAY_PATTERN = /^(\d{2})-(\d{2})$/;

/** 校验 IANA 时区是否被运行时支持。 */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function parseMonthDay(value: string): { month: number; day: number } | null {
  const match = MONTH_DAY_PATTERN.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1) return null;
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > maxDay) return null;
  return { month, day };
}

export function isValidMonthDay(value: string): boolean {
  return parseMonthDay(value) !== null;
}

function monthDayInYear(value: string, year: number): string {
  const parsed = parseMonthDay(value);
  if (!parsed) throw new Error(`非法月日：${value}`);
  const month = String(parsed.month).padStart(2, "0");
  const day = String(parsed.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type YearWindow = {
  year: number;
  startDate: string;
  endDate: string;
};

/**
 * 把物候窗口（MM-DD ~ MM-DD）解析成某一年的当地日历日。
 * 不支持跨年折返（如 12-15 ~ 01-10），窗口必须 start <= end；
 * 结束日落在 2 月 29 日而该年为平年时，收敛到 2 月 28 日。
 */
export function resolveYearWindow(windowStart: string, windowEnd: string, year: number): YearWindow {
  const startParsed = parseMonthDay(windowStart);
  const endParsed = parseMonthDay(windowEnd);
  if (!startParsed || !endParsed) throw new Error("非法物候窗口");

  let endDate = monthDayInYear(windowEnd, year);
  if (windowEnd === "02-29" && parseDateString(endDate) === null) {
    endDate = `${year}-02-28`;
  }
  const startDate = monthDayInYear(windowStart, year);
  if (startDate > endDate) throw new Error("物候窗口起始日不能晚于结束日");
  return { year, startDate, endDate };
}

/** 窗口开始前 reminderDays 天的提醒日（reminderDays 为 0 时与窗口开始同日）。 */
export function reminderDateFor(window: YearWindow, reminderDays: number): string {
  return addDays(window.startDate, -Math.max(0, reminderDays));
}

/**
 * 扫描时需要覆盖的年份：上一年（窗口刚结束、可能仍未完成）、今年、下一年（提前生成）。
 * 以任务自身时区的"今天"为准，避免跨时区用户提前/滞后凭空生成或漏生成。
 */
export function candidateYears(timezone: string, now = new Date()): number[] {
  const currentYear = Number(todayInTimezone(timezone, now).slice(0, 4));
  return [currentYear - 1, currentYear, currentYear + 1];
}

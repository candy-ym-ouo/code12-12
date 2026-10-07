import { describe, expect, it } from "vitest";
import { candidateYears, isValidTimezone, parseMonthDay, reminderDateFor, resolveYearWindow } from "../lib/taskWindow";

describe("resolveYearWindow", () => {
  it("把 MM-DD 窗口解析成具体年份日期", () => {
    expect(resolveYearWindow("03-01", "03-31", 2026)).toEqual({
      year: 2026,
      startDate: "2026-03-01",
      endDate: "2026-03-31",
    });
  });

  it("窗口起始晚于结束时报错（不支持跨年折返）", () => {
    expect(() => resolveYearWindow("12-15", "01-10", 2026)).toThrow();
  });

  it("结束日为 02-29 时在平年收敛到 02-28，闰年保留", () => {
    expect(resolveYearWindow("02-01", "02-29", 2025).endDate).toBe("2025-02-28");
    expect(resolveYearWindow("02-01", "02-29", 2024).endDate).toBe("2024-02-29");
  });

  it("拒绝非法月日", () => {
    expect(parseMonthDay("13-01")).toBeNull();
    expect(parseMonthDay("02-30")).toBeNull();
    expect(parseMonthDay("2026-03-01")).toBeNull();
    expect(parseMonthDay("03-01")).toEqual({ month: 3, day: 1 });
  });
});

describe("reminderDateFor", () => {
  it("按提前天数回推提醒日", () => {
    const window = resolveYearWindow("03-10", "03-20", 2026);
    expect(reminderDateFor(window, 7)).toBe("2026-03-03");
    expect(reminderDateFor(window, 0)).toBe("2026-03-10");
  });

  it("负数提前量按 0 处理", () => {
    const window = resolveYearWindow("03-10", "03-20", 2026);
    expect(reminderDateFor(window, -5)).toBe("2026-03-10");
  });
});

describe("candidateYears", () => {
  it("按给定 UTC 时刻与时区覆盖上一年/今年/下一年", () => {
    // UTC 2026-01-01 00:00，东八区仍是 2025-12-31
    expect(candidateYears("Asia/Shanghai", new Date("2026-01-01T00:00:00Z"))).toEqual([2025, 2026, 2027]);
    // 同一时刻在 UTC 时区已进入 2026
    expect(candidateYears("UTC", new Date("2026-01-01T00:00:00Z"))).toEqual([2025, 2026, 2027]);
    // 年末：UTC 2026-12-31 17:00，东八区已到 2027-01-01
    expect(candidateYears("Asia/Shanghai", new Date("2026-12-31T17:00:00Z"))).toEqual([2026, 2027, 2028]);
    expect(candidateYears("UTC", new Date("2026-12-31T17:00:00Z"))).toEqual([2025, 2026, 2027]);
  });
});

describe("isValidTimezone", () => {
  it("识别合法与非法时区", () => {
    expect(isValidTimezone("Asia/Shanghai")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Asia/NotACity")).toBe(false);
  });
});

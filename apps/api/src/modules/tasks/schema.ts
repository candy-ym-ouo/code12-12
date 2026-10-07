import { z } from "zod";
import { isValidDateString } from "../../lib/date";
import { isValidMonthDay, isValidTimezone } from "../../lib/taskWindow";
import { observationKindSchema } from "../observations/schema";

const dateStringSchema = z.string().refine(isValidDateString, "日期格式应为 YYYY-MM-DD");

const monthDaySchema = z
  .string()
  .refine((value) => isValidMonthDay(value), "物候窗口格式应为 MM-DD 且日期合法");

const timezoneSchema = z.string().refine(isValidTimezone, "不支持的时区，请使用 IANA 时区名（如 Asia/Shanghai）");

const taskFields = {
  title: z.string().trim().min(1, "请填写任务名称").max(80, "任务名称过长"),
  siteId: z.string().min(1, "请选择观察地点"),
  speciesId: z.string().min(1).nullish(),
  phenophaseId: z.string().min(1).nullish(),
  kind: observationKindSchema,
  windowStart: monthDaySchema,
  windowEnd: monthDaySchema,
  timezone: timezoneSchema.default("Asia/Shanghai"),
  reminderDays: z.coerce.number().int().min(0, "提醒提前天数不能为负").max(180).default(0),
  note: z.string().trim().max(1000, "备注过长").nullish(),
};

export const createTaskSchema = z
  .object(taskFields)
  .refine((data) => data.windowStart <= data.windowEnd, {
    path: ["windowEnd"],
    message: "物候窗口起始日不能晚于结束日（暂不支持跨年窗口）",
  });

export const updateTaskSchema = z
  .object({
    title: z.string().trim().min(1, "请填写任务名称").max(80, "任务名称过长").optional(),
    siteId: z.string().min(1).optional(),
    speciesId: z.string().min(1).nullish(),
    phenophaseId: z.string().min(1).nullish(),
    kind: observationKindSchema.optional(),
    windowStart: monthDaySchema.optional(),
    windowEnd: monthDaySchema.optional(),
    timezone: timezoneSchema.optional(),
    reminderDays: z.coerce.number().int().min(0).max(180).optional(),
    note: z.string().trim().max(1000).nullish(),
  })
  .refine((data) => Object.keys(data).length > 0, "至少需要提供一个待更新字段");

export const listTasksQuerySchema = z.object({
  status: z.enum(["ACTIVE", "CLOSED", "ALL"]).default("ACTIVE"),
  siteId: z.string().min(1).optional(),
});

export const completeInstanceSchema = z
  .object({
    observationId: z.string().min(1).optional(),
    observationDate: dateStringSchema.optional(),
    note: z.string().trim().max(1000).nullish(),
    force: z.boolean().optional(),
  })
  .refine((data) => !(data.observationId && data.observationDate), {
    message: "关联已有观测与直接补录日期二选一",
  });

export const skipInstanceSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const scanTasksQuerySchema = z.object({
  all: z.union([z.literal("true"), z.literal("false"), z.boolean()]).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CompleteInstanceInput = z.infer<typeof completeInstanceSchema>;
export type SkipInstanceInput = z.infer<typeof skipInstanceSchema>;

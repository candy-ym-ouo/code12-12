import { z } from "zod";
import { isValidDateString } from "../../lib/date";
import { isValidMonthDay } from "../../lib/taskScheduler";
import { observationKindSchema } from "../observations/schema";

const monthDaySchema = z
  .string()
  .refine(isValidMonthDay, "物候窗口日期格式应为 MM-DD，且必须是合法日期（如 03-01）");

const dateStringSchema = z.string().refine(isValidDateString, "日期格式应为 YYYY-MM-DD");

const taskRuleFields = {
  name: z.string().trim().min(1, "请填写任务名称").max(80, "任务名称过长"),
  siteId: z.string().min(1, "请选择观察地点"),
  speciesId: z.string().min(1).nullish(),
  phenophaseId: z.string().min(1).nullish(),
  kind: observationKindSchema,
  windowStartMd: monthDaySchema,
  windowEndMd: monthDaySchema,
  dueOffsetDays: z.number().int().min(-30).max(200).default(0),
  remindBeforeDays: z.number().int().min(0).max(60).default(3),
  active: z.boolean().default(true),
};

const ruleFieldsSchema = z.object(taskRuleFields);

export const createTaskRuleSchema = ruleFieldsSchema.refine((data) => !data.phenophaseId || !!data.speciesId, {
  path: ["phenophaseId"],
  message: "指定物候阶段时必须同时指定物种",
});

export const updateTaskRuleSchema = ruleFieldsSchema
  .omit({ siteId: true, kind: true })
  .partial()
  .refine((data) => Object.keys(data).length > 0, "至少需要提供一个待更新字段");

export const listTasksQuerySchema = z.object({
  status: z.enum(["OPEN", "DONE", "CLOSED", "ALL", "OVERDUE"]).default("OPEN"),
  siteId: z.string().min(1).optional(),
  ruleId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const completeTaskSchema = z.object({
  observationId: z.string().min(1).optional(),
  // 直接补录：不传 observationId 时按任务模板快速登记一条观测
  observationDate: dateStringSchema.optional(),
  notes: z.string().trim().max(5000).nullish(),
  createObservation: z.boolean().default(true),
});

export const listEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const closeTaskSchema = z
  .object({ reason: z.string().trim().max(500).nullish() })
  .default({});

export type CreateTaskRuleInput = z.infer<typeof createTaskRuleSchema>;
export type UpdateTaskRuleInput = z.infer<typeof updateTaskRuleSchema>;
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

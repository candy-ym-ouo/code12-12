import { Router } from "express";
import { z } from "zod";
import { todayInTimezone } from "../../lib/date";
import { asyncHandler, sendData } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  closeTaskSchema,
  completeTaskSchema,
  createTaskRuleSchema,
  listEventsQuerySchema,
  listTasksQuerySchema,
  updateTaskRuleSchema,
  type CompleteTaskInput,
  type CreateTaskRuleInput,
  type ListTasksQuery,
  type UpdateTaskRuleInput,
} from "./schema";
import * as service from "./service";

export const taskRouter = Router();

taskRouter.use(requireAuth);

const idParams = z.object({ id: z.string().min(1) });

// ── 规则 ───────────────────────────────────────────────────────────────────

taskRouter.get(
  "/task-rules",
  asyncHandler(async (req, res) => {
    sendData(res, await service.listRules(currentUser(req).id));
  }),
);

taskRouter.post(
  "/task-rules",
  validate({ body: createTaskRuleSchema }),
  asyncHandler(async (req, res) => {
    const rule = await service.createRule(currentUser(req).id, validatedBody<CreateTaskRuleInput>(req));
    sendData(res, rule, undefined, 201);
  }),
);

taskRouter.patch(
  "/task-rules/:id",
  validate({ params: idParams, body: updateTaskRuleSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.updateRule(currentUser(req).id, id, validatedBody<UpdateTaskRuleInput>(req)));
  }),
);

taskRouter.delete(
  "/task-rules/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.deleteRule(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);

// ── 扫描与待办 ─────────────────────────────────────────────────────────────

taskRouter.post(
  "/scan",
  asyncHandler(async (req, res) => {
    const result = await service.scanUserTasks(currentUser(req).id);
    sendData(res, result);
  }),
);

taskRouter.get(
  "/history",
  validate({ query: listEventsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { limit } = validatedQuery<{ limit: number }>(req);
    sendData(res, await service.listHistoryFeed(currentUser(req).id, limit));
  }),
);

taskRouter.get(
  "/",
  validate({ query: listTasksQuerySchema }),
  asyncHandler(async (req, res) => {
    const userId = currentUser(req).id;
    const query = validatedQuery<ListTasksQuery>(req);
    // 读列表前先按用户时区扫描一次；扫描幂等，重复调用不会多产生任何待办或事件。
    await service.scanUserTasks(userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const today = todayInTimezone(user.timezone);
    sendData(res, await service.listTasks(userId, query, today));
  }),
);

taskRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const userId = currentUser(req).id;
    const { id } = validatedParams<{ id: string }>(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timezone: true } });
    const today = todayInTimezone(user.timezone);
    sendData(res, await service.getTask(userId, id, today));
  }),
);

taskRouter.get(
  "/:id/events",
  validate({ params: idParams, query: listEventsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const { limit } = validatedQuery<{ limit: number }>(req);
    sendData(res, await service.listTaskEvents(currentUser(req).id, id, limit));
  }),
);

taskRouter.post(
  "/:id/complete",
  validate({ params: idParams, body: completeTaskSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const task = await service.completeTask(
      currentUser(req).id,
      id,
      validatedBody<CompleteTaskInput>(req),
    );
    sendData(res, task);
  }),
);

taskRouter.post(
  "/:id/close",
  validate({ params: idParams, body: closeTaskSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    const body = validatedBody<{ reason?: string | null }>(req);
    sendData(res, await service.closeTask(currentUser(req).id, id, body));
  }),
);

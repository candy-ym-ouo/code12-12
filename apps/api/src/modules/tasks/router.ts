import { Router } from "express";
import { z } from "zod";
import { ApiError, asyncHandler, sendData } from "../../lib/http";
import { prisma } from "../../lib/prisma";
import { currentUser, requireAuth } from "../../middleware/auth";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate";
import {
  completeInstanceSchema,
  createTaskSchema,
  listTasksQuerySchema,
  skipInstanceSchema,
  updateTaskSchema,
  type CompleteInstanceInput,
  type CreateTaskInput,
  type ListTasksQuery,
  type SkipInstanceInput,
  type UpdateTaskInput,
} from "./schema";
import * as service from "./service";

export const taskRouter = Router();
export const taskAdminRouter = Router();

const idParams = z.object({ id: z.string().min(1) });
const instanceParams = z.object({ instanceId: z.string().min(1) });

taskRouter.use(requireAuth);

taskRouter.get(
  "/",
  validate({ query: listTasksQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = validatedQuery<ListTasksQuery>(req);
    sendData(res, await service.listTasks(currentUser(req).id, query));
  }),
);

taskRouter.post(
  "/",
  validate({ body: createTaskSchema }),
  asyncHandler(async (req, res) => {
    const input = validatedBody<CreateTaskInput>(req);
    sendData(res, await service.createTask(currentUser(req).id, input), undefined, 201);
  }),
);

// 用户主动触发：只扫描本人的活动任务，返回推进结果（提醒/逾期/补录条数）。
taskRouter.post(
  "/scan",
  asyncHandler(async (req, res) => {
    const userId = currentUser(req).id;
    const tasks = await prisma.observationTask.findMany({
      where: { ownerId: userId, status: "ACTIVE" },
      include: service.taskRelationsInclude,
    });
    const summary = {
      tasksScanned: 0,
      instancesCreated: 0,
      remindersSent: 0,
      overdueMarked: 0,
      autoCompleted: 0,
      autoBackfilled: 0,
    };
    for (const task of tasks) {
      const part = await service.scanUserTask(task);
      summary.tasksScanned += 1;
      for (const key of ["instancesCreated", "remindersSent", "overdueMarked", "autoCompleted", "autoBackfilled"] as const) {
        summary[key] += part[key];
      }
    }
    sendData(res, summary);
  }),
);

taskRouter.get(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.getTask(currentUser(req).id, id));
  }),
);

taskRouter.patch(
  "/:id",
  validate({ params: idParams, body: updateTaskSchema }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.updateTask(currentUser(req).id, id, validatedBody<UpdateTaskInput>(req)));
  }),
);

// DELETE 语义为关闭（软关闭，保留全部实例与历史）。
taskRouter.delete(
  "/:id",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    await service.closeTask(currentUser(req).id, id);
    sendData(res, { ok: true });
  }),
);

taskRouter.post(
  "/:id/close",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.closeTask(currentUser(req).id, id));
  }),
);

taskRouter.post(
  "/:id/reopen",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.reopenTask(currentUser(req).id, id));
  }),
);

taskRouter.get(
  "/:id/events",
  validate({ params: idParams }),
  asyncHandler(async (req, res) => {
    const { id } = validatedParams<{ id: string }>(req);
    sendData(res, await service.listEvents(currentUser(req).id, id));
  }),
);

taskRouter.post(
  "/instances/:instanceId/complete",
  validate({ params: instanceParams, body: completeInstanceSchema }),
  asyncHandler(async (req, res) => {
    const { instanceId } = validatedParams<{ instanceId: string }>(req);
    sendData(
      res,
      await service.completeInstance(currentUser(req).id, instanceId, validatedBody<CompleteInstanceInput>(req)),
    );
  }),
);

taskRouter.post(
  "/instances/:instanceId/skip",
  validate({ params: instanceParams, body: skipInstanceSchema }),
  asyncHandler(async (req, res) => {
    const { instanceId } = validatedParams<{ instanceId: string }>(req);
    sendData(res, await service.skipInstance(currentUser(req).id, instanceId, validatedBody<SkipInstanceInput>(req)));
  }),
);

taskRouter.post(
  "/instances/:instanceId/reopen",
  validate({ params: instanceParams }),
  asyncHandler(async (req, res) => {
    const { instanceId } = validatedParams<{ instanceId: string }>(req);
    sendData(res, await service.reopenInstance(currentUser(req).id, instanceId));
  }),
);

// 全量扫描：仅 ADMIN 可调用（日常由进程内定时器自动执行）。
taskAdminRouter.use(requireAuth);
taskAdminRouter.post(
  "/scan",
  asyncHandler(async (req, res) => {
    if (currentUser(req).role !== "ADMIN") {
      throw new ApiError(403, "FORBIDDEN", "仅管理员可触发全量扫描");
    }
    sendData(res, await service.scanAllTasks());
  }),
);

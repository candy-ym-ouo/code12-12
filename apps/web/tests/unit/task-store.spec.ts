import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useTaskStore } from "@/stores/task";
import type { ObservationTask } from "@/types/models";

vi.mock("@/api", () => ({
  taskApi: {
    list: vi.fn(),
    get: vi.fn(),
    events: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    close: vi.fn(),
    reopen: vi.fn(),
    scan: vi.fn(),
    completeInstance: vi.fn(),
    skipInstance: vi.fn(),
    reopenInstance: vi.fn(),
  },
}));

import { taskApi } from "@/api";

function makeTask(id: string, overrides: Partial<ObservationTask["summary"]> & { status?: ObservationTask["status"] } = {}): ObservationTask {
  return {
    id,
    title: `任务 ${id}`,
    kind: "PLANT_PHENOLOGY",
    site: { id: "site", name: "测试点" },
    species: null,
    phenophase: null,
    windowStart: "03-01",
    windowEnd: "03-31",
    timezone: "Asia/Shanghai",
    reminderDays: 0,
    note: null,
    status: overrides.status ?? "ACTIVE",
    closedAt: null,
    eventCount: 0,
    instances: [],
    summary: {
      pending: overrides.pending ?? 0,
      overdue: overrides.overdue ?? 0,
      completed: overrides.completed ?? 0,
      backfilled: overrides.backfilled ?? 0,
      skipped: overrides.skipped ?? 0,
    },
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
  };
}

describe("task store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("汇总所有活动任务的逾期数，已关闭任务不计入", async () => {
    vi.mocked(taskApi.list).mockResolvedValue([
      makeTask("a", { overdue: 2, pending: 1 }),
      makeTask("b", { overdue: 1 }),
      makeTask("c", { overdue: 5, status: "CLOSED" }),
    ]);
    const store = useTaskStore();
    await store.fetch();

    expect(store.overdueCount).toBe(3);
    expect(store.pendingCount).toBe(4);
  });

  it("扫描后刷新列表并返回推进结果", async () => {
    vi.mocked(taskApi.scan).mockResolvedValue({
      tasksScanned: 2,
      instancesCreated: 1,
      remindersSent: 0,
      overdueMarked: 0,
      autoCompleted: 0,
      autoBackfilled: 0,
    });
    vi.mocked(taskApi.list).mockResolvedValue([makeTask("a", { pending: 4 })]);

    const store = useTaskStore();
    const summary = await store.scan();
    expect(summary.instancesCreated).toBe(1);
    expect(taskApi.list).toHaveBeenCalledWith({ status: "ALL" });
    expect(store.tasks).toHaveLength(1);
  });

  it("补录登记后当前详情任务同步更新", async () => {
    const updated = makeTask("a", { backfilled: 1 });
    vi.mocked(taskApi.completeInstance).mockResolvedValue(updated);
    vi.mocked(taskApi.list).mockResolvedValue([]);

    const store = useTaskStore();
    store.activeTask = makeTask("a");
    const result = await store.completeInstance("inst-1", { observationDate: "2026-04-02" });
    expect(result.summary.backfilled).toBe(1);
    expect(store.activeTask?.summary.backfilled).toBe(1);
  });
});

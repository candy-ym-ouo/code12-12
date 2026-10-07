import { defineStore } from "pinia";
import { taskApi } from "@/api";
import type { ObservationTask, TaskEvent } from "@/types/models";

interface TaskState {
  tasks: ObservationTask[];
  activeTask: ObservationTask | null;
  events: TaskEvent[];
  loading: boolean;
}

export const useTaskStore = defineStore("task", {
  state: (): TaskState => ({
    tasks: [],
    activeTask: null,
    events: [],
    loading: false,
  }),

  getters: {
    overdueCount: (state) =>
      state.tasks.reduce((sum, task) => sum + (task.status === "ACTIVE" ? task.summary.overdue : 0), 0),
    pendingCount: (state) =>
      state.tasks.reduce(
        (sum, task) => sum + (task.status === "ACTIVE" ? task.summary.pending + task.summary.overdue : 0),
        0,
      ),
  },

  actions: {
    async fetch(status: "ACTIVE" | "CLOSED" | "ALL" = "ACTIVE") {
      this.loading = true;
      try {
        this.tasks = await taskApi.list({ status });
      } finally {
        this.loading = false;
      }
    },
    async fetchOne(id: string) {
      this.activeTask = await taskApi.get(id);
      return this.activeTask;
    },
    async fetchEvents(id: string) {
      this.events = await taskApi.events(id);
      return this.events;
    },
    async create(payload: Record<string, unknown>) {
      const task = await taskApi.create(payload);
      await this.fetch("ALL");
      return task;
    },
    async update(id: string, payload: Record<string, unknown>) {
      const task = await taskApi.update(id, payload);
      if (this.activeTask?.id === id) this.activeTask = task;
      await this.fetch("ALL");
      return task;
    },
    async close(id: string) {
      await taskApi.close(id);
      await this.fetch("ALL");
      if (this.activeTask?.id === id) await this.fetchOne(id);
    },
    async reopen(id: string) {
      const task = await taskApi.reopen(id);
      await this.fetch("ALL");
      if (this.activeTask?.id === id) this.activeTask = task;
    },
    async scan() {
      const summary = await taskApi.scan();
      await this.fetch("ALL");
      return summary;
    },
    async completeInstance(instanceId: string, payload: Record<string, unknown>) {
      const task = await taskApi.completeInstance(instanceId, payload);
      if (this.activeTask?.id === task.id) this.activeTask = task;
      await this.fetch("ALL");
      return task;
    },
    async skipInstance(instanceId: string, reason?: string) {
      const task = await taskApi.skipInstance(instanceId, reason);
      if (this.activeTask?.id === task.id) this.activeTask = task;
      await this.fetch("ALL");
      return task;
    },
    async reopenInstance(instanceId: string) {
      const task = await taskApi.reopenInstance(instanceId);
      if (this.activeTask?.id === task.id) this.activeTask = task;
      await this.fetch("ALL");
      return task;
    },
  },
});

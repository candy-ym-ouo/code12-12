<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Refresh, Clock, Warning, Select } from "@element-plus/icons-vue";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import { useTaskStore } from "@/stores/task";
import {
  KIND_LABELS,
  TASK_EVENT_LABELS,
  TASK_INSTANCE_STATUS_LABELS,
  type ObservationKind,
  type ObservationTask,
  type TaskInstance,
} from "@/types/models";

const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();
const taskStore = useTaskStore();

const statusFilter = ref<"ACTIVE" | "CLOSED" | "ALL">("ACTIVE");
const dialogVisible = ref(false);
const editingId = ref<string | null>(null);
const saving = ref(false);
const scanning = ref(false);
const historyVisible = ref(false);
const historyTaskId = ref<string | null>(null);
const historyEvents = ref<Array<{ id: string; type: keyof typeof TASK_EVENT_LABELS; instanceId: string | null; detail: Record<string, unknown> | null; createdAt: string }>>([]);
const historyLoading = ref(false);

const completeTarget = ref<{ task: ObservationTask; instance: TaskInstance } | null>(null);
const completeDialogTitle = computed(() =>
  completeTarget.value ? `登记观察结果 · ${completeTarget.value.instance.year} 年` : "登记观察结果",
);
const completeForm = reactive({ observationDate: dayjs().format("YYYY-MM-DD"), note: "" });
const completeSaving = ref(false);

const form = reactive({
  title: "",
  siteId: "" as string,
  kind: "PLANT_PHENOLOGY" as ObservationKind,
  speciesId: "" as string,
  phenophaseId: "" as string,
  windowStart: "03-01",
  windowEnd: "03-31",
  timezone: "Asia/Shanghai",
  reminderDays: 0,
  note: "",
});

const KIND_OPTIONS = Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }));
const TIMEZONE_OPTIONS = [
  "Asia/Shanghai",
  "Asia/Urumqi",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Bangkok",
  "UTC",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];

const speciesOptions = computed(() => {
  const category: Record<string, string | null> = {
    PLANT_PHENOLOGY: "PLANT",
    INSECT_SIGHTING: "INSECT",
    BIRD_SOUND: "BIRD",
    WEATHER_ANOMALY: null,
  };
  const wanted = category[form.kind];
  if (!wanted) return [];
  return speciesStore.mine.filter((species) => species.category === wanted);
});

const phenophaseOptions = computed(() =>
  speciesOptions.value.find((species) => species.id === form.speciesId)?.phenophases ?? [],
);

async function load() {
  try {
    await taskStore.fetch(statusFilter.value);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

onMounted(async () => {
  await Promise.all([siteStore.fetch(true), speciesStore.fetch()]);
  await load();
});

function resetForm() {
  Object.assign(form, {
    title: "",
    siteId: siteStore.sites.find((site) => !site.archivedAt)?.id ?? "",
    kind: "PLANT_PHENOLOGY",
    speciesId: "",
    phenophaseId: "",
    windowStart: "03-01",
    windowEnd: "03-31",
    timezone: "Asia/Shanghai",
    reminderDays: 0,
    note: "",
  });
}

function openCreate() {
  editingId.value = null;
  resetForm();
  dialogVisible.value = true;
}

function openEdit(task: ObservationTask) {
  editingId.value = task.id;
  Object.assign(form, {
    title: task.title,
    siteId: task.site.id,
    kind: task.kind,
    speciesId: task.species?.id ?? "",
    phenophaseId: task.phenophase?.id ?? "",
    windowStart: task.windowStart,
    windowEnd: task.windowEnd,
    timezone: task.timezone,
    reminderDays: task.reminderDays,
    note: task.note ?? "",
  });
  dialogVisible.value = true;
}

async function save() {
  if (!form.title.trim()) return ElMessage.warning("请填写任务名称");
  if (!form.siteId) return ElMessage.warning("请选择观察地点");
  if (form.windowStart > form.windowEnd) return ElMessage.warning("物候窗口起始日不能晚于结束日");

  saving.value = true;
  const payload = {
    title: form.title.trim(),
    siteId: form.siteId,
    kind: form.kind,
    speciesId: form.speciesId || null,
    phenophaseId: form.phenophaseId || null,
    windowStart: form.windowStart,
    windowEnd: form.windowEnd,
    timezone: form.timezone,
    reminderDays: form.reminderDays,
    note: form.note || null,
  };
  try {
    if (editingId.value) {
      await taskStore.update(editingId.value, payload);
      ElMessage.success("任务已更新，未完成待办的窗口日期已同步校正");
    } else {
      await taskStore.create(payload);
      ElMessage.success("任务已创建，并立即生成了今年及相邻年份的待办");
    }
    dialogVisible.value = false;
    await load();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    saving.value = false;
  }
}

async function runScan() {
  scanning.value = true;
  try {
    const summary = await taskStore.scan();
    const pushed =
      summary.instancesCreated +
      summary.remindersSent +
      summary.overdueMarked +
      summary.autoCompleted +
      summary.autoBackfilled;
    ElMessage.success(
      pushed === 0
        ? "扫描完成，没有新变化（重复扫描不会生成重复待办）"
        : `扫描完成：新建 ${summary.instancesCreated}、提醒 ${summary.remindersSent}、逾期 ${summary.overdueMarked}、自动完成 ${summary.autoCompleted}、补录 ${summary.autoBackfilled}`,
    );
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    scanning.value = false;
  }
}

function openComplete(task: ObservationTask, instance: TaskInstance) {
  completeTarget.value = { task, instance };
  completeForm.observationDate = dayjs().format("YYYY-MM-DD");
  completeForm.note = "";
}

async function submitComplete() {
  if (!completeTarget.value) return;
  completeSaving.value = true;
  try {
    await taskStore.completeInstance(completeTarget.value.instance.id, {
      observationDate: completeForm.observationDate,
      note: completeForm.note || null,
    });
    const late = dayjs(completeForm.observationDate).isAfter(completeTarget.value.instance.windowEndDate);
    ElMessage.success(late ? "已按逾期补录登记，历史已留痕" : "已按时完成登记");
    completeTarget.value = null;
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    completeSaving.value = false;
  }
}

async function skip(task: ObservationTask, instance: TaskInstance) {
  try {
    const { value } = await ElMessageBox.prompt("跳过该年度待办后不会再被标记逾期，可随时重开。", `跳过 ${instance.year} 年待办`, {
      confirmButtonText: "跳过",
      cancelButtonText: "取消",
      inputPlaceholder: "原因（可选）",
      inputType: "textarea",
    });
    await taskStore.skipInstance(instance.id, value || undefined);
    ElMessage.success("已跳过，历史已留痕");
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

async function reopenInstance(task: ObservationTask, instance: TaskInstance) {
  try {
    await taskStore.reopenInstance(instance.id);
    ElMessage.success("待办已重新打开");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function closeTask(task: ObservationTask) {
  try {
    await ElMessageBox.confirm(`关闭后扫描将不再为「${task.title}」生成提醒与逾期，全部历史保留，可重新打开。`, "关闭任务", {
      type: "warning",
    });
    await taskStore.close(task.id);
    ElMessage.success("任务已关闭，历史保留");
    await load();
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

async function reopenTask(task: ObservationTask) {
  try {
    await taskStore.reopen(task.id);
    ElMessage.success("任务已重新打开");
    await load();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function openHistory(task: ObservationTask) {
  historyTaskId.value = task.id;
  historyVisible.value = true;
  historyLoading.value = true;
  try {
    historyEvents.value = await taskStore.fetchEvents(task.id);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    historyLoading.value = false;
  }
}

function statusTagType(instance: TaskInstance): "info" | "success" | "warning" | "danger" | "primary" {
  if (instance.status === "COMPLETED") return "success";
  if (instance.status === "BACKFILLED") return "warning";
  if (instance.status === "SKIPPED") return "info";
  return instance.isOverdue ? "danger" : "primary";
}

function describeTiming(instance: TaskInstance): string {
  if (instance.status === "PENDING" && instance.isOverdue) return `已逾期 ${-instance.daysUntilEnd} 天`;
  if (instance.status === "PENDING" && instance.reminderDue) return "今日起进入观察期，请安排巡查";
  if (instance.status === "PENDING" && instance.daysUntilStart > 0) return `距窗口开始还有 ${instance.daysUntilStart} 天`;
  if (instance.status === "PENDING") return `观察窗口进行中，剩余 ${instance.daysUntilEnd} 天`;
  if (instance.status === "BACKFILLED") return `逾期 ${instance.completedDaysLate} 天后补录`;
  if (instance.status === "COMPLETED") return "窗口内按时完成";
  return "已跳过";
}

function formatEventDetail(detail: Record<string, unknown> | null): string {
  if (!detail) return "";
  return JSON.stringify(detail);
}
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div>
        <h1 class="page-title">观察任务</h1>
        <p class="page-subtitle">
          按物候窗口与当地时区逐年生成待办；系统定时扫描提醒、逾期与补录，所有动作均保留历史。
        </p>
      </div>
      <div class="row">
        <el-radio-group v-model="statusFilter" @change="load">
          <el-radio-button value="ACTIVE">进行中</el-radio-button>
          <el-radio-button value="CLOSED">已关闭</el-radio-button>
          <el-radio-button value="ALL">全部</el-radio-button>
        </el-radio-group>
        <el-button :icon="Refresh" :loading="scanning" @click="runScan">立即扫描</el-button>
        <el-button type="primary" :icon="Plus" @click="openCreate">新建任务</el-button>
      </div>
    </header>

    <div v-if="taskStore.overdueCount > 0" class="alert-bar">
      <el-icon><Warning /></el-icon>
      当前有 {{ taskStore.overdueCount }} 个年度待办已逾期，可补录观察日期并保留逾期记录。
    </div>

    <EmptyState
      v-if="!taskStore.tasks.length && !taskStore.loading"
      title="还没有观察任务"
      description="例如：每年 3 月上旬到下旬，在校园银杏道观察银杏发芽。系统会按任务时区自动生成每年的待办。"
      action-text="新建观察任务"
      @action="openCreate"
    />

    <div v-else class="task-list">
      <article v-for="task in taskStore.tasks" :key="task.id" class="task card">
        <header class="task__header">
          <div class="task__heading">
            <h2 class="task__name">{{ task.title }}</h2>
            <el-tag v-if="task.status === 'CLOSED'" size="small" type="info">已关闭</el-tag>
            <el-tag v-else-if="task.summary.overdue" size="small" type="danger">
              {{ task.summary.overdue }} 个逾期
            </el-tag>
          </div>
          <div class="task__actions">
            <el-button size="small" @click="openHistory(task)">历史 ({{ task.eventCount }})</el-button>
            <el-button v-if="task.status === 'ACTIVE'" size="small" @click="openEdit(task)">编辑</el-button>
            <el-button v-if="task.status === 'ACTIVE'" size="small" type="danger" plain @click="closeTask(task)">关闭</el-button>
            <el-button v-else size="small" type="primary" plain @click="reopenTask(task)">重新打开</el-button>
          </div>
        </header>

        <p class="task__meta muted">
          {{ KIND_LABELS[task.kind] }} · {{ task.site.name }}
          <template v-if="task.species"> · {{ task.species.commonName }}<template v-if="task.phenophase"> / {{ task.phenophase.name }}</template></template>
          · 窗口 {{ task.windowStart }} ~ {{ task.windowEnd }}
          · {{ task.timezone }}
          <template v-if="task.reminderDays > 0"> · 提前 {{ task.reminderDays }} 天提醒</template>
        </p>

        <div class="instance-list">
          <div
            v-for="instance in task.instances"
            :key="instance.id"
            class="instance"
            :class="{ 'instance--overdue': instance.isOverdue }"
          >
            <div class="instance__main">
              <div class="instance__year">{{ instance.year }}</div>
              <div class="instance__window muted">
                <el-icon><Clock /></el-icon>
                {{ instance.windowStartDate }} ~ {{ instance.windowEndDate }}
              </div>
              <div class="instance__state">
                <el-tag :type="statusTagType(instance)" size="small">
                  {{ TASK_INSTANCE_STATUS_LABELS[instance.status] }}
                </el-tag>
                <span class="instance__timing muted">{{ describeTiming(instance) }}</span>
              </div>
            </div>
            <div v-if="task.status === 'ACTIVE'" class="instance__ops">
              <template v-if="instance.status === 'PENDING'">
                <el-button size="small" type="primary" :icon="Select" @click="openComplete(task, instance)">
                  登记 / 补录
                </el-button>
                <el-button size="small" @click="skip(task, instance)">跳过</el-button>
              </template>
              <el-button v-else size="small" @click="reopenInstance(task, instance)">重开</el-button>
            </div>
          </div>
        </div>
      </article>
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑观察任务' : '新建观察任务'" width="min(560px, 94vw)">
      <el-form label-position="top">
        <el-form-item label="任务名称" required>
          <el-input v-model="form.title" maxlength="80" placeholder="例如：银杏发芽巡查" />
        </el-form-item>
        <el-form-item label="观察地点" required>
          <el-select v-model="form.siteId" filterable placeholder="选择地点">
            <el-option v-for="site in siteStore.sites" :key="site.id" :label="site.name" :value="site.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="观察类型">
          <el-select v-model="form.kind">
            <el-option v-for="option in KIND_OPTIONS" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <template v-if="form.kind !== 'WEATHER_ANOMALY'">
          <el-form-item label="物种（可选）">
            <el-select v-model="form.speciesId" clearable placeholder="选择后可自动匹配已登记观测">
              <el-option v-for="species in speciesOptions" :key="species.id" :label="species.commonName" :value="species.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="phenophaseOptions.length" label="物候阶段（可选）">
            <el-select v-model="form.phenophaseId" clearable>
              <el-option v-for="phase in phenophaseOptions" :key="phase.id" :label="phase.name" :value="phase.id" />
            </el-select>
          </el-form-item>
        </template>
        <div class="dialog-grid">
          <el-form-item label="窗口开始（月-日）" required>
            <el-input v-model="form.windowStart" placeholder="MM-DD，如 03-01" />
          </el-form-item>
          <el-form-item label="窗口结束（月-日）" required>
            <el-input v-model="form.windowEnd" placeholder="MM-DD，如 03-31" />
          </el-form-item>
          <el-form-item label="时区">
            <el-select v-model="form.timezone" filterable allow-create>
              <el-option v-for="tz in TIMEZONE_OPTIONS" :key="tz" :label="tz" :value="tz" />
            </el-select>
          </el-form-item>
          <el-form-item label="提前提醒天数">
            <el-input-number v-model="form.reminderDays" :min="0" :max="180" controls-position="right" />
          </el-form-item>
        </div>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" maxlength="1000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="completeTarget"
      :title="completeDialogTitle"
      width="min(440px, 92vw)"
    >
      <p v-if="completeTarget" class="muted dialog-note">
        窗口：{{ completeTarget.instance.windowStartDate }} ~ {{ completeTarget.instance.windowEndDate }}。
        晚于窗口结束将记为「逾期补录」，逾期天数会一并写入历史。
      </p>
      <el-form label-position="top">
        <el-form-item label="实际观察日期" required>
          <el-date-picker
            v-model="completeForm.observationDate"
            type="date"
            value-format="YYYY-MM-DD"
            :clearable="false"
            class="full-width"
          />
        </el-form-item>
        <el-form-item label="备注（可选）">
          <el-input v-model="completeForm.note" type="textarea" :rows="2" maxlength="1000" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="completeTarget = null">取消</el-button>
        <el-button type="primary" :loading="completeSaving" @click="submitComplete">确认登记</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="historyVisible" :with-header="false" size="min(420px, 92vw)">
      <div class="history">
        <h3>任务历史</h3>
        <p v-if="historyLoading" class="muted">加载中…</p>
        <el-timeline v-else>
          <el-timeline-item
            v-for="event in historyEvents"
            :key="event.id"
            :timestamp="dayjs(event.createdAt).format('YYYY-MM-DD HH:mm:ss')"
            :type="event.type === 'OVERDUE' || event.type === 'BACKFILLED' ? 'warning' : 'primary'"
          >
            <strong>{{ TASK_EVENT_LABELS[event.type] }}</strong>
            <pre v-if="event.detail" class="history__detail">{{ formatEventDetail(event.detail) }}</pre>
          </el-timeline-item>
        </el-timeline>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.page-header .row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.alert-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  border-radius: 6px;
  background: var(--color-danger-soft, #fdecec);
  color: var(--color-danger, #b3261e);
  font-size: 14px;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.task {
  padding: 16px;
}

.task__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.task__heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task__name {
  margin: 0;
  font-size: 16px;
}

.task__actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.task__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.task__meta {
  margin: 6px 0 12px;
  font-size: 13px;
}

.instance-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.instance {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  flex-wrap: wrap;
}

.instance--overdue {
  border-color: var(--color-danger, #b3261e);
  background: var(--color-danger-soft, #fdecec);
}

.instance__main {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.instance__year {
  font-weight: 700;
  font-size: 15px;
  min-width: 44px;
}

.instance__window {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}

.instance__state {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.instance__timing {
  font-size: 13px;
}

.instance__ops {
  display: flex;
  gap: 6px;
}

.instance__ops :deep(.el-button + .el-button) {
  margin-left: 0;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.full-width {
  width: 100%;
}

.dialog-note {
  font-size: 13px;
  margin-top: 0;
}

.history {
  padding: 20px;
}

.history__detail {
  margin: 4px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text-muted);
}

@media (max-width: 767px) {
  .dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>

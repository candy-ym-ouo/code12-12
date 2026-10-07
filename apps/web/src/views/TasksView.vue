<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import dayjs from "dayjs";
import { ElMessage, ElMessageBox } from "element-plus";
import { Bell, CircleCheck, CircleClose, Plus, RefreshRight } from "@element-plus/icons-vue";
import { taskApi } from "@/api";
import { apiErrorMessage } from "@/api/client";
import EmptyState from "@/components/EmptyState.vue";
import { useSiteStore } from "@/stores/site";
import { useSpeciesStore } from "@/stores/species";
import {
  KIND_LABELS,
  TASK_EVENT_LABELS,
  TASK_STATUS_LABELS,
  type ObservationTask,
  type TaskEvent,
  type TaskRule,
  type TaskStatus,
} from "@/types/models";

type TaskTab = "OVERDUE" | "OPEN" | "DONE" | "CLOSED" | "ALL";

const siteStore = useSiteStore();
const speciesStore = useSpeciesStore();

const activeTab = ref<TaskTab>("OVERDUE");
const tasks = ref<ObservationTask[]>([]);
const rules = ref<TaskRule[]>([]);
const history = ref<TaskEvent[]>([]);
const loading = ref(false);
const scanning = ref(false);

const ruleDialogVisible = ref(false);
const editingRuleId = ref<string | null>(null);
const savingRule = ref(false);

const historyDialogVisible = ref(false);
const historyTask = ref<ObservationTask | null>(null);

const form = reactive({
  name: "",
  kind: "PLANT_PHENOLOGY" as keyof typeof KIND_LABELS,
  siteId: "" as string,
  speciesId: "" as string,
  phenophaseId: "" as string,
  windowStartMd: "03-01",
  windowEndMd: "04-15",
  dueOffsetDays: 0,
  remindBeforeDays: 3,
  active: true,
});

const monthDayValidator = (_rule: unknown, value: string, callback: (error?: Error) => void) => {
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    callback(new Error("格式应为 MM-DD，例如 03-01"));
    return;
  }
  const [month, day] = value.split("-").map(Number);
  const maxDay = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > maxDay) callback(new Error("该月没有这一天"));
  else callback();
};

const formRules = {
  name: [{ required: true, message: "请填写任务名称", trigger: "blur" }],
  siteId: [{ required: true, message: "请选择观察地点", trigger: "change" }],
  windowStartMd: [{ required: true, validator: monthDayValidator, trigger: "blur" }],
  windowEndMd: [{ required: true, validator: monthDayValidator, trigger: "blur" }],
};

const ruleFormRef = ref();

const speciesOptions = computed(() =>
  speciesStore.mine.filter((species) => {
    if (form.kind === "WEATHER_ANOMALY") return false;
    const categoryByKind: Record<string, string> = {
      PLANT_PHENOLOGY: "PLANT",
      INSECT_SIGHTING: "INSECT",
      BIRD_SOUND: "BIRD",
    };
    return species.category === categoryByKind[form.kind];
  }),
);

const selectedSpeciesPhases = computed(() => {
  const species = speciesStore.byId(form.speciesId);
  return species?.phenophases ?? [];
});

async function ensureStores() {
  await Promise.all([siteStore.fetch(true), speciesStore.fetch()]);
}

async function loadTasks() {
  loading.value = true;
  try {
    tasks.value = await taskApi.list({ status: activeTab.value, limit: 100 });
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    loading.value = false;
  }
}

async function loadRules() {
  try {
    rules.value = await taskApi.listRules();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function scan() {
  scanning.value = true;
  try {
    const result = await taskApi.scan();
    ElMessage.success(`扫描完成：新增 ${result.created} · 提醒 ${result.reminders} · 逾期 ${result.overdue}`);
    await loadTasks();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    scanning.value = false;
  }
}

function openCreateRule() {
  editingRuleId.value = null;
  Object.assign(form, {
    name: "",
    kind: "PLANT_PHENOLOGY",
    siteId: siteStore.sites[0]?.id ?? "",
    speciesId: "",
    phenophaseId: "",
    windowStartMd: "03-01",
    windowEndMd: "04-15",
    dueOffsetDays: 0,
    remindBeforeDays: 3,
    active: true,
  });
  ruleDialogVisible.value = true;
}

function openEditRule(rule: TaskRule) {
  editingRuleId.value = rule.id;
  Object.assign(form, {
    name: rule.name,
    kind: rule.kind,
    siteId: rule.site.id,
    speciesId: rule.species?.id ?? "",
    phenophaseId: rule.phenophase?.id ?? "",
    windowStartMd: rule.windowStartMd,
    windowEndMd: rule.windowEndMd,
    dueOffsetDays: rule.dueOffsetDays,
    remindBeforeDays: rule.remindBeforeDays,
    active: rule.active,
  });
  ruleDialogVisible.value = true;
}

async function saveRule() {
  if (!ruleFormRef.value) return;
  try {
    await ruleFormRef.value.validate();
  } catch {
    return;
  }
  savingRule.value = true;
  const payload = {
    name: form.name.trim(),
    kind: form.kind,
    siteId: form.siteId,
    speciesId: form.speciesId || null,
    phenophaseId: form.speciesId ? form.phenophaseId || null : null,
    windowStartMd: form.windowStartMd,
    windowEndMd: form.windowEndMd,
    dueOffsetDays: form.dueOffsetDays,
    remindBeforeDays: form.remindBeforeDays,
    active: form.active,
  };
  try {
    if (editingRuleId.value) {
      await taskApi.updateRule(editingRuleId.value, payload);
      ElMessage.success("规则已更新");
    } else {
      await taskApi.createRule(payload);
      ElMessage.success("规则已创建，扫描后将在窗口开始时生成待办");
    }
    ruleDialogVisible.value = false;
    await loadRules();
    await loadTasks();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  } finally {
    savingRule.value = false;
  }
}

async function toggleRule(rule: TaskRule) {
  try {
    await taskApi.updateRule(rule.id, { active: !rule.active });
    await loadRules();
    ElMessage.success(rule.active ? "规则已停用，不再生成新待办（历史保留）" : "规则已启用");
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function removeRule(rule: TaskRule) {
  try {
    await ElMessageBox.confirm(
      rule.taskCount ? `该规则已产生 ${rule.taskCount} 条待办，无法删除，可改为停用。仍要尝试删除吗？` : "删除后不可恢复，确定删除该规则吗？",
      "删除规则",
      { type: "warning" },
    );
    await taskApi.deleteRule(rule.id);
    ElMessage.success("规则已删除");
    await loadRules();
  } catch (error) {
    if (error !== "cancel") ElMessage.error(apiErrorMessage(error));
  }
}

async function completeNow(task: ObservationTask) {
  try {
    // 默认按今天登记一条观测并完成（今天不会被判定为补录）
    await taskApi.complete(task.id, {});
    ElMessage.success("已标记为如期完成，并登记一条观测");
    await loadTasks();
    await loadRules();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function backfill(task: ObservationTask) {
  let date: string;
  try {
    const { value } = await ElMessageBox.prompt("请输入实际观察日期（YYYY-MM-DD）", "补录完成", {
      inputValue: task.dueDate,
      inputPattern: /^\d{4}-\d{2}-\d{2}$/,
      inputErrorMessage: "日期格式应为 YYYY-MM-DD",
    });
    date = value;
  } catch {
    return;
  }
  try {
    await taskApi.complete(task.id, { observationDate: date });
    ElMessage.success("已按补录完成，并登记观测");
    await loadTasks();
    await loadRules();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function closeTask(task: ObservationTask) {
  let reason: string | undefined;
  try {
    const { value } = await ElMessageBox.prompt("可填写关闭原因（留空跳过）", "关闭待办", {
      inputType: "textarea",
    });
    reason = value || undefined;
  } catch {
    return;
  }
  try {
    await taskApi.close(task.id, reason);
    ElMessage.success("已关闭，历史保留可查");
    await loadTasks();
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

async function openHistory(task: ObservationTask) {
  historyTask.value = task;
  historyDialogVisible.value = true;
  try {
    history.value = await taskApi.events(task.id);
  } catch (error) {
    ElMessage.error(apiErrorMessage(error));
  }
}

function dueText(task: ObservationTask): string {
  if (task.status !== "OPEN") return "";
  const d = task.daysUntilDue ?? 0;
  if (task.overdue) return `已逾期 ${Math.abs(d)} 天`;
  if (d === 0) return "今天到期";
  return `还剩 ${d} 天`;
}

function eventTagType(type: TaskEvent["type"]): "danger" | "warning" | "success" | "info" | "primary" {
  if (type === "OVERDUE") return "danger";
  if (type === "REMINDER_SENT") return "warning";
  if (type === "COMPLETED" || type === "BACKFILLED") return "success";
  if (type === "CLOSED") return "info";
  return "primary";
}

function statusTagType(status: TaskStatus): "danger" | "success" | "info" | "warning" {
  if (status === "DONE") return "success";
  if (status === "CLOSED") return "info";
  return "warning";
}

onMounted(async () => {
  await ensureStores();
  await Promise.all([loadTasks(), loadRules()]);
});
</script>

<template>
  <div class="page page--wide">
    <header class="page-header">
      <div>
        <h1 class="page-title">观察任务</h1>
        <p class="page-subtitle">
          按物候窗口与你的时区自动生成待办；进入窗口当天生成，目标日前提醒，逾期与完成/补录/关闭全程留痕
        </p>
      </div>
      <div class="row">
        <el-button :loading="scanning" @click="scan">
          <el-icon><RefreshRight /></el-icon>
          立即扫描
        </el-button>
        <el-button type="primary" @click="openCreateRule">
          <el-icon><Plus /></el-icon>
          新建观察计划
        </el-button>
      </div>
    </header>

    <el-tabs v-model="activeTab" @tab-change="loadTasks">
      <el-tab-pane label="逾期" name="OVERDUE" />
      <el-tab-pane label="待办" name="OPEN" />
      <el-tab-pane label="已完成" name="DONE" />
      <el-tab-pane label="已关闭" name="CLOSED" />
      <el-tab-pane label="全部" name="ALL" />
    </el-tabs>

    <EmptyState
      v-if="!tasks.length && !loading"
      title="没有匹配的任务"
      description="新建观察计划后，进入物候窗口时会自动生成待办；也可以点右上角「立即扫描」手动触发。"
      action-text="新建观察计划"
      @action="openCreateRule"
    />

    <div v-loading="loading" class="task-list">
      <article v-for="task in tasks" :key="task.id" class="task card">
        <div class="task__main">
          <div class="task__title-row">
            <h2 class="task__name">{{ task.rule.name }}</h2>
            <el-tag v-if="task.overdue" size="small" type="danger" effect="dark">逾期</el-tag>
            <el-tag v-else-if="task.status === 'OPEN' && task.daysUntilDue === 0" size="small" type="warning">
              今天到期
            </el-tag>
            <el-tag
              v-else-if="task.status !== 'OPEN'"
              size="small"
              :type="statusTagType(task.status)"
            >
              {{ TASK_STATUS_LABELS[task.status] }}
            </el-tag>
            <el-tag v-else-if="task.reminderSentAt" size="small" type="warning" effect="plain">
              <el-icon><Bell /></el-icon>
              已提醒
            </el-tag>
          </div>

          <p class="task__meta muted">
            {{ KIND_LABELS[task.rule.kind] }} · {{ task.rule.site.name }}
            <template v-if="task.rule.species">· {{ task.rule.species.commonName }}</template>
            <template v-if="task.rule.phenophase">· {{ task.rule.phenophase.name }}</template>
          </p>
          <p class="task__dates muted">
            窗口 {{ task.windowStart }} ~ {{ task.windowEnd }} · 目标日 {{ task.dueDate }}
            <span v-if="task.status === 'OPEN'" :class="['task__due', { 'is-overdue': task.overdue }]">
              · {{ dueText(task) }}
            </span>
          </p>
        </div>

        <footer class="task__actions">
          <template v-if="task.status === 'OPEN'">
            <el-button size="small" type="primary" @click="completeNow(task)">
              <el-icon><CircleCheck /></el-icon>
              今天完成
            </el-button>
            <el-button size="small" @click="backfill(task)">补录</el-button>
            <el-button size="small" plain @click="closeTask(task)">
              <el-icon><CircleClose /></el-icon>
              关闭
            </el-button>
          </template>
          <el-button size="small" text @click="openHistory(task)">历史</el-button>
        </footer>
      </article>
    </div>

    <section class="rules">
      <h2 class="rules__title">观察计划（{{ rules.length }}）</h2>
      <el-table :data="rules" size="small" empty-text="还没有观察计划">
        <el-table-column label="名称" min-width="140">
          <template #default="{ row }: { row: TaskRule }">
            <span>{{ row.name }}</span>
            <el-tag v-if="!row.active" size="small" type="info" class="rules__inactive">已停用</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="100">
          <template #default="{ row }: { row: TaskRule }">{{ KIND_LABELS[row.kind] }}</template>
        </el-table-column>
        <el-table-column label="地点 / 物种" min-width="160">
          <template #default="{ row }: { row: TaskRule }">
            {{ row.site.name }}<template v-if="row.species"> · {{ row.species.commonName }}</template>
          </template>
        </el-table-column>
        <el-table-column label="物候窗口" width="150">
          <template #default="{ row }: { row: TaskRule }">
            {{ row.windowStartMd }} ~ {{ row.windowEndMd }}
          </template>
        </el-table-column>
        <el-table-column label="目标日 / 提前提醒" width="150">
          <template #default="{ row }: { row: TaskRule }">
            窗口+{{ row.dueOffsetDays }} 天 / 提前 {{ row.remindBeforeDays }} 天
          </template>
        </el-table-column>
        <el-table-column label="待办" width="70" prop="taskCount" />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }: { row: TaskRule }">
            <el-button size="small" link @click="openEditRule(row)">编辑</el-button>
            <el-button size="small" link @click="toggleRule(row)">{{ row.active ? "停用" : "启用" }}</el-button>
            <el-button size="small" link type="danger" @click="removeRule(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <!-- 新建 / 编辑规则 -->
    <el-dialog
      v-model="ruleDialogVisible"
      :title="editingRuleId ? '编辑观察计划' : '新建观察计划'"
      width="min(560px, 94vw)"
    >
      <el-form ref="ruleFormRef" :model="form" :rules="formRules" label-position="top">
        <el-form-item label="任务名称" prop="name">
          <el-input v-model="form.name" maxlength="80" placeholder="例如：银杏芽鳞开裂首现观察" />
        </el-form-item>
        <div class="dialog-grid">
          <el-form-item label="观察类型" prop="kind">
            <el-select v-model="form.kind" @change="form.speciesId = ''; form.phenophaseId = ''">
              <el-option v-for="(label, key) in KIND_LABELS" :key="key" :value="key" :label="label" />
            </el-select>
          </el-form-item>
          <el-form-item label="观察地点" prop="siteId">
            <el-select v-model="form.siteId" filterable>
              <el-option v-for="site in siteStore.sites" :key="site.id" :value="site.id" :label="site.name" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.kind !== 'WEATHER_ANOMALY'" label="物种（可选）">
            <el-select v-model="form.speciesId" clearable filterable @change="form.phenophaseId = ''">
              <el-option v-for="species in speciesOptions" :key="species.id" :value="species.id" :label="species.commonName" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="form.speciesId" label="物候阶段（可选）">
            <el-select v-model="form.phenophaseId" clearable>
              <el-option v-for="phase in selectedSpeciesPhases" :key="phase.id" :value="phase.id" :label="phase.name" />
            </el-select>
          </el-form-item>
          <el-form-item label="窗口开始（MM-DD）" prop="windowStartMd">
            <el-input v-model="form.windowStartMd" placeholder="03-01" />
          </el-form-item>
          <el-form-item label="窗口结束（MM-DD）" prop="windowEndMd">
            <el-input v-model="form.windowEndMd" placeholder="04-15（晚于开始为跨年窗口）" />
          </el-form-item>
          <el-form-item label="目标日 = 窗口开始后 N 天">
            <el-input-number v-model="form.dueOffsetDays" :min="-30" :max="200" controls-position="right" />
          </el-form-item>
          <el-form-item label="提前提醒天数">
            <el-input-number v-model="form.remindBeforeDays" :min="0" :max="60" controls-position="right" />
          </el-form-item>
        </div>
        <el-form-item>
          <el-checkbox v-model="form.active">启用（停用后不再为新窗口生成待办，历史保留）</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingRule" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>

    <!-- 单任务历史 -->
    <el-dialog v-model="historyDialogVisible" :title="`历史 · ${historyTask?.rule.name ?? ''}`" width="min(520px, 94vw)">
      <el-timeline>
        <el-timeline-item
          v-for="event in history"
          :key="event.id"
          :type="eventTagType(event.type)"
          :timestamp="dayjs(event.occurredAt).format('YYYY-MM-DD HH:mm')"
        >
          <el-tag size="small" :type="eventTagType(event.type)">{{ TASK_EVENT_LABELS[event.type] }}</el-tag>
          <span v-if="event.type === 'OVERDUE'" class="muted">
            目标日 {{ event.payload.dueDate }}，发现于 {{ event.payload.detectedOn }}
          </span>
          <span v-else-if="event.type === 'REMINDER_SENT'" class="muted">
            目标日 {{ event.payload.dueDate }}，提醒于 {{ event.payload.sentOn }}
          </span>
          <span v-else-if="event.type === 'BACKFILLED'" class="muted">
            实际观察 {{ event.payload.observationDate }}
          </span>
          <span v-else-if="event.type === 'CLOSED' && event.payload.reason" class="muted">
            {{ event.payload.reason }}
          </span>
        </el-timeline-item>
      </el-timeline>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.task-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 60px;
}

.task {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  flex-wrap: wrap;
}

.task__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task__name {
  margin: 0;
  font-size: 16px;
}

.task__meta,
.task__dates {
  margin: 4px 0 0;
  font-size: 13px;
}

.task__due.is-overdue {
  color: var(--el-color-danger);
  font-weight: 600;
}

.task__actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.task__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.rules {
  margin-top: 28px;
}

.rules__title {
  font-size: 15px;
  margin-bottom: 8px;
}

.rules__inactive {
  margin-left: 8px;
}

.dialog-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.dialog-grid .el-select,
.dialog-grid .el-input,
.dialog-grid .el-input-number {
  width: 100%;
}

@media (max-width: 767px) {
  .dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>

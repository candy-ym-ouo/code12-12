export type SpeciesCategory = "PLANT" | "INSECT" | "BIRD" | "WEATHER";

export type ObservationKind = "PLANT_PHENOLOGY" | "INSECT_SIGHTING" | "BIRD_SOUND" | "WEATHER_ANOMALY";

export type ObservationStatus = "DRAFT" | "PUBLISHED";

export type AnomalyType =
  | "COLD_WAVE"
  | "HEAT_WAVE"
  | "DROUGHT"
  | "FLOOD"
  | "LATE_FROST"
  | "UNSEASONAL_RAIN"
  | "OTHER";

export type AnomalySeverity = "MILD" | "MODERATE" | "SEVERE";

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: string;
  timezone: string;
  createdAt: string;
}

export interface Site {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  elevationM: number | null;
  habitat: string | null;
  description: string | null;
  archivedAt: string | null;
  observationCount: number;
  speciesCount: number;
  lastObservedAt: string | null;
  createdAt: string;
}

export interface Phenophase {
  id: string;
  speciesId: string;
  name: string;
  code: string | null;
  color: string;
  orderIndex: number;
  isDefault: boolean;
}

export interface Species {
  id: string;
  ownerId: string | null;
  category: SpeciesCategory;
  commonName: string;
  scientificName: string | null;
  family: string | null;
  description: string | null;
  isPreset: boolean;
  archivedAt: string | null;
  phenophases: Phenophase[];
  _count?: { observations: number };
}

export interface Photo {
  id: string;
  thumbUrl: string;
  displayUrl: string;
  originalUrl?: string;
  width: number;
  height: number;
  bytes: number;
  takenAt: string | null;
  sortOrder: number;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  _count?: { observations: number };
}

export interface Observation {
  id: string;
  kind: ObservationKind;
  status: ObservationStatus;
  observationDate: string;
  observedAt: string | null;
  title: string | null;
  notes: string | null;
  temperatureC: number | null;
  precipitationMm: number | null;
  windLevel: number | null;
  humidityPct: number | null;
  anomalyType: AnomalyType | null;
  anomalySeverity: AnomalySeverity | null;
  impactNotes: string | null;
  source: string;
  site: { id: string; name: string; latitude: number | null; longitude: number | null };
  species: { id: string; commonName: string; category: SpeciesCategory; scientificName: string | null } | null;
  phenophase: { id: string; name: string; color: string } | null;
  photos: Photo[];
  tags: Tag[];
  createdAt: string;
  updatedAt: string;
}

export interface ObservationMeta {
  hasMore: boolean;
  nextCursor: string | null;
  emptyReason?: "NO_DATA" | "FILTERED_OUT";
}

export interface CompareYearItem {
  year: number;
  onsetDate: string | null;
  dayOfYear: number | null;
  offsetVsPrevYear: number | null;
  offsetVsBaseline: number | null;
  baselineDayOfYear: number | null;
  offsetText: string;
  observationId: string | null;
  observationsInYear: number;
  title: string | null;
  notes: string | null;
  phenophase: { id: string; name: string; color: string } | null;
  photo: { thumbUrl: string; displayUrl: string } | null;
  photoCount: number;
}

export interface CompareResult {
  site: { id: string; name: string };
  species: { id: string; commonName: string; category: SpeciesCategory };
  phenophase: { id: string; name: string; color: string } | null;
  years: CompareYearItem[];
  baseline: { method: "median"; yearsUsed: number[]; dayOfYear: number } | null;
  reason?: "INSUFFICIENT_HISTORY";
  missingYears: number[];
}

export interface PhenologyResult {
  site: { id: string; name: string };
  species: { id: string; commonName: string; category: SpeciesCategory };
  items: Array<{
    year: number;
    onsetDate: string | null;
    dayOfYear: number | null;
    offsetVsPrevYear: number | null;
    offsetVsBaseline: number | null;
    baselineDayOfYear: number | null;
    offsetText: string;
    observationId: string | null;
  }>;
  baseline: { method: "median"; yearsUsed: number[]; dayOfYear: number } | null;
  reason?: "INSUFFICIENT_HISTORY";
}

export interface ShareLink {
  id: string;
  token: string;
  scope: "TIMELINE" | "TIMELINE_AND_COMPARE";
  url: string;
  expiresAt: string;
  revokedAt?: string | null;
  viewCount: number;
}

export type ObservationTaskStatus = "ACTIVE" | "CLOSED";

export type TaskInstanceStatus = "PENDING" | "COMPLETED" | "BACKFILLED" | "SKIPPED";

export type TaskEventType =
  | "CREATED"
  | "UPDATED"
  | "REMINDER_SENT"
  | "OVERDUE"
  | "COMPLETED"
  | "BACKFILLED"
  | "CLOSED"
  | "REOPENED"
  | "SKIPPED";

export interface TaskInstance {
  id: string;
  year: number;
  windowStartDate: string;
  windowEndDate: string;
  reminderDate: string | null;
  status: TaskInstanceStatus;
  observationId: string | null;
  completedAt: string | null;
  completedDate: string | null;
  completedDaysLate: number | null;
  completionNote: string | null;
  remindedAt: string | null;
  overdueMarkedAt: string | null;
  reopenedAt: string | null;
  isOverdue: boolean;
  reminderDue: boolean;
  daysUntilStart: number;
  daysUntilEnd: number;
  today: string;
  createdAt: string;
  updatedAt: string;
}

export interface ObservationTask {
  id: string;
  title: string;
  kind: ObservationKind;
  site: { id: string; name: string };
  species: { id: string; commonName: string; category: SpeciesCategory } | null;
  phenophase: { id: string; name: string; color: string } | null;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  reminderDays: number;
  note: string | null;
  status: ObservationTaskStatus;
  closedAt: string | null;
  eventCount: number;
  instances: TaskInstance[];
  summary: {
    pending: number;
    overdue: number;
    completed: number;
    backfilled: number;
    skipped: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  type: TaskEventType;
  instanceId: string | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

export const TASK_EVENT_LABELS: Record<TaskEventType, string> = {
  CREATED: "创建任务",
  UPDATED: "修改任务",
  REMINDER_SENT: "发送提醒",
  OVERDUE: "标记逾期",
  COMPLETED: "按时完成",
  BACKFILLED: "逾期补录",
  CLOSED: "关闭任务",
  REOPENED: "重新打开",
  SKIPPED: "跳过",
};

export const TASK_INSTANCE_STATUS_LABELS: Record<TaskInstanceStatus, string> = {
  PENDING: "待观察",
  COMPLETED: "已完成",
  BACKFILLED: "逾期补录",
  SKIPPED: "已跳过",
};

export const KIND_LABELS: Record<ObservationKind, string> = {
  PLANT_PHENOLOGY: "树木发芽",
  INSECT_SIGHTING: "昆虫出现",
  BIRD_SOUND: "鸟鸣变化",
  WEATHER_ANOMALY: "天气异常",
};

export const CATEGORY_LABELS: Record<SpeciesCategory, string> = {
  PLANT: "植物",
  INSECT: "昆虫",
  BIRD: "鸟类",
  WEATHER: "天气现象",
};

export const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  COLD_WAVE: "寒潮",
  HEAT_WAVE: "热浪",
  DROUGHT: "干旱",
  FLOOD: "洪涝",
  LATE_FROST: "倒春寒 / 晚霜",
  UNSEASONAL_RAIN: "异常降水",
  OTHER: "其他",
};

export const ANOMALY_SEVERITY_LABELS: Record<AnomalySeverity, string> = {
  MILD: "轻微",
  MODERATE: "中等",
  SEVERE: "严重",
};

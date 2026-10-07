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

// ── 观察任务 ────────────────────────────────────────────────────────────────

export type TaskStatus = "OPEN" | "DONE" | "CLOSED";

export type TaskEventType =
  | "CREATED"
  | "REMINDER_SENT"
  | "OVERDUE"
  | "COMPLETED"
  | "BACKFILLED"
  | "CLOSED";

export interface TaskRule {
  id: string;
  name: string;
  kind: ObservationKind;
  windowStartMd: string;
  windowEndMd: string;
  dueOffsetDays: number;
  remindBeforeDays: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  site: { id: string; name: string };
  species: { id: string; commonName: string } | null;
  phenophase: { id: string; name: string; color: string } | null;
  taskCount?: number;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  type: TaskEventType;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ObservationTask {
  id: string;
  status: TaskStatus;
  occurrenceKey: string;
  windowStart: string;
  windowEnd: string;
  dueDate: string;
  reminderSentAt: string | null;
  completedAt: string | null;
  completedDate: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  overdue: boolean;
  daysUntilDue: number | null;
  rule: {
    id: string;
    name: string;
    kind: ObservationKind;
    remindBeforeDays: number;
    site: { id: string; name: string };
    species: { id: string; commonName: string } | null;
    phenophase: { id: string; name: string; color: string } | null;
  };
  observation: { id: string; observationDate: string; title: string | null; kind: ObservationKind } | null;
  events: TaskEvent[];
}

export interface TaskScanResult {
  created: number;
  reminders: number;
  overdue: number;
  usersScanned: number;
}

export const TASK_EVENT_LABELS: Record<TaskEventType, string> = {
  CREATED: "已生成",
  REMINDER_SENT: "到期提醒",
  OVERDUE: "逾期提醒",
  COMPLETED: "如期完成",
  BACKFILLED: "补录完成",
  CLOSED: "已关闭",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "待办",
  DONE: "已完成",
  CLOSED: "已关闭",
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

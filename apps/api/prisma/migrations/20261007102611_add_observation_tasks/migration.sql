-- CreateTable
CREATE TABLE "ObservationTaskRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "speciesId" TEXT,
    "phenophaseId" TEXT,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "windowStartMd" TEXT NOT NULL,
    "windowEndMd" TEXT NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "remindBeforeDays" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ObservationTaskRule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTaskRule_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ObservationTaskRule_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ObservationTaskRule_phenophaseId_fkey" FOREIGN KEY ("phenophaseId") REFERENCES "Phenophase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "windowStart" TEXT NOT NULL,
    "windowEnd" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "reminderSentAt" DATETIME,
    "completedAt" DATETIME,
    "completedDate" TEXT,
    "observationId" TEXT,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ObservationTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTask_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ObservationTaskRule" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ObservationTask_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationTaskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservationTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ObservationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTaskEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ObservationTaskRule_ownerId_active_idx" ON "ObservationTaskRule"("ownerId", "active");

-- CreateIndex
CREATE INDEX "ObservationTaskRule_siteId_idx" ON "ObservationTaskRule"("siteId");

-- CreateIndex
CREATE INDEX "ObservationTask_ownerId_status_dueDate_idx" ON "ObservationTask"("ownerId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "ObservationTask_status_reminderSentAt_dueDate_idx" ON "ObservationTask"("status", "reminderSentAt", "dueDate");

-- CreateIndex
CREATE INDEX "ObservationTask_ruleId_idx" ON "ObservationTask"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationTask_ownerId_ruleId_occurrenceKey_key" ON "ObservationTask"("ownerId", "ruleId", "occurrenceKey");

-- CreateIndex
CREATE INDEX "ObservationTaskEvent_taskId_occurredAt_idx" ON "ObservationTaskEvent"("taskId", "occurredAt");

-- CreateIndex
CREATE INDEX "ObservationTaskEvent_ownerId_occurredAt_idx" ON "ObservationTaskEvent"("ownerId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationTaskEvent_taskId_type_key" ON "ObservationTaskEvent"("taskId", "type");

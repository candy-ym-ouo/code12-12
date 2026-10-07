-- CreateTable
CREATE TABLE "ObservationTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "speciesId" TEXT,
    "phenophaseId" TEXT,
    "kind" TEXT NOT NULL,
    "windowStart" TEXT NOT NULL,
    "windowEnd" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "reminderDays" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ObservationTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTask_speciesId_fkey" FOREIGN KEY ("speciesId") REFERENCES "Species" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ObservationTask_phenophaseId_fkey" FOREIGN KEY ("phenophaseId") REFERENCES "Phenophase" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationTaskInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "windowStartDate" TEXT NOT NULL,
    "windowEndDate" TEXT NOT NULL,
    "reminderDate" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "observationId" TEXT,
    "completedAt" DATETIME,
    "completedDate" TEXT,
    "completedDaysLate" INTEGER,
    "completionNote" TEXT,
    "remindedAt" DATETIME,
    "overdueMarkedAt" DATETIME,
    "reopenedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ObservationTaskInstance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ObservationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ObservationTaskInstance_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationTaskEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "taskId" TEXT NOT NULL,
    "instanceId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ObservationTaskEvent_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ObservationTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ObservationTask_ownerId_title_key" ON "ObservationTask"("ownerId", "title");

-- CreateIndex
CREATE INDEX "ObservationTask_ownerId_status_idx" ON "ObservationTask"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ObservationTask_siteId_idx" ON "ObservationTask"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ObservationTaskInstance_taskId_year_key" ON "ObservationTaskInstance"("taskId", "year");

-- CreateIndex
CREATE INDEX "ObservationTaskInstance_status_year_idx" ON "ObservationTaskInstance"("status", "year");

-- CreateIndex
CREATE INDEX "ObservationTaskInstance_observationId_idx" ON "ObservationTaskInstance"("observationId");

-- CreateIndex
CREATE INDEX "ObservationTaskEvent_taskId_createdAt_idx" ON "ObservationTaskEvent"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "ObservationTaskEvent_instanceId_idx" ON "ObservationTaskEvent"("instanceId");

-- CreateEnum
CREATE TYPE "CheckInScheduleType" AS ENUM ('INTERVAL', 'CRON');

-- CreateEnum
CREATE TYPE "CheckInMonitorStatus" AS ENUM ('NEW', 'UP', 'DOWN', 'PAUSED');

-- CreateEnum
CREATE TYPE "CheckInKind" AS ENUM ('START', 'OK', 'FAIL', 'MISSED', 'TIMEOUT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertRuleType" ADD VALUE 'CHECKIN_DOWN';
ALTER TYPE "AlertRuleType" ADD VALUE 'CHECKIN_RECOVERED';

-- CreateTable
CREATE TABLE "CheckInMonitor" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "schedule_type" "CheckInScheduleType" NOT NULL,
    "interval_seconds" INTEGER,
    "cron_expr" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "grace_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_runtime_seconds" INTEGER,
    "destination_ids" JSONB NOT NULL,
    "status" "CheckInMonitorStatus" NOT NULL DEFAULT 'NEW',
    "last_ping_at" TIMESTAMP(3),
    "next_due_at" TIMESTAMP(3),
    "deadline_at" TIMESTAMP(3),
    "down_since" TIMESTAMP(3),
    "incident_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "CheckInMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckIn" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "kind" "CheckInKind" NOT NULL,
    "run_id" TEXT,
    "exit_code" INTEGER,
    "duration_ms" INTEGER,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInRun" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "timeout_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "CheckInRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInNotice" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "rule" "AlertRuleType" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "destination_ids" JSONB NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CheckInMonitor_token_hash_key" ON "CheckInMonitor"("token_hash");

-- CreateIndex
CREATE INDEX "CheckInMonitor_project_id_deleted_at_idx" ON "CheckInMonitor"("project_id", "deleted_at");

-- CreateIndex
CREATE INDEX "CheckInMonitor_status_deadline_at_idx" ON "CheckInMonitor"("status", "deadline_at");

-- CreateIndex
CREATE INDEX "CheckIn_monitor_id_received_at_idx" ON "CheckIn"("monitor_id", "received_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_monitor_id_run_id_kind_key" ON "CheckIn"("monitor_id", "run_id", "kind");

-- CreateIndex
CREATE INDEX "CheckInRun_timeout_at_finished_at_idx" ON "CheckInRun"("timeout_at", "finished_at");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInRun_monitor_id_run_id_key" ON "CheckInRun"("monitor_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "CheckInNotice_dedupe_key_key" ON "CheckInNotice"("dedupe_key");

-- CreateIndex
CREATE INDEX "CheckInNotice_delivered_at_id_idx" ON "CheckInNotice"("delivered_at", "id");

-- AddForeignKey
ALTER TABLE "CheckInMonitor" ADD CONSTRAINT "CheckInMonitor_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "CheckInMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInRun" ADD CONSTRAINT "CheckInRun_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "CheckInMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInNotice" ADD CONSTRAINT "CheckInNotice_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "CheckInMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;


CREATE INDEX "CheckIn_received_at_idx" ON "CheckIn"("received_at");

-- Defensive constraints for writes outside the management API.
ALTER TABLE "CheckInMonitor" ADD CONSTRAINT "CheckInMonitor_schedule_check" CHECK (
  (schedule_type = 'INTERVAL' AND interval_seconds IS NOT NULL AND interval_seconds >= 300 AND cron_expr IS NULL)
  OR (schedule_type = 'CRON' AND cron_expr IS NOT NULL AND interval_seconds IS NULL)
);
ALTER TABLE "CheckInMonitor" ADD CONSTRAINT "CheckInMonitor_grace_check" CHECK (grace_seconds BETWEEN 60 AND 86400);
ALTER TABLE "CheckInMonitor" ADD CONSTRAINT "CheckInMonitor_runtime_check" CHECK (max_runtime_seconds IS NULL OR max_runtime_seconds BETWEEN 1 AND 604800);
ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_exit_code_check" CHECK (exit_code IS NULL OR exit_code BETWEEN 0 AND 255);

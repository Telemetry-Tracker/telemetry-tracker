-- Last successful scheduled-job run, so /health can show a missing alert-rules evaluator.
CREATE TABLE "ScheduledJobHeartbeat" (
    "job" TEXT NOT NULL,
    "last_ok_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJobHeartbeat_pkey" PRIMARY KEY ("job")
);

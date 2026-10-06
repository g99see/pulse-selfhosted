-- Полный чек-ин (ТЗ v2 §4): средние энергия/стресс/сон по дню и черновики диалога.
-- Столбцы nullable: старые записи «только настроение» остаются валидными.
ALTER TABLE "daily_stats"
  ADD COLUMN "avg_energy" DOUBLE PRECISION,
  ADD COLUMN "avg_stress" DOUBLE PRECISION,
  ADD COLUMN "avg_sleep" DOUBLE PRECISION;

CREATE TABLE "check_in_drafts" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "step" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "check_in_drafts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "check_in_drafts_user_id_channel_key" ON "check_in_drafts"("user_id", "channel");
CREATE INDEX "check_in_drafts_expires_at_idx" ON "check_in_drafts"("expires_at");

ALTER TABLE "check_in_drafts"
  ADD CONSTRAINT "check_in_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

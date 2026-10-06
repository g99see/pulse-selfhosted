-- Откат 20261006130000_checkin_full: средние самочувствия по дню и черновики диалога.
-- Средние восстанавливаются пересчётом статистики после повторного наката.
DROP TABLE IF EXISTS "check_in_drafts";
ALTER TABLE "daily_stats"
  DROP COLUMN IF EXISTS "avg_energy",
  DROP COLUMN IF EXISTS "avg_stress",
  DROP COLUMN IF EXISTS "avg_sleep";

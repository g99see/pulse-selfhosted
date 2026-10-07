-- Достижения v3 (ТЗ v2 §4): уровни (bronze/silver/gold) и отпечаток каталога для
-- тихого пересчёта. Написано вручную и идемпотентно (IF NOT EXISTS / IF EXISTS):
-- повторный запуск на уже мигрированной базе не падает.

-- 1. Уровень в выданных достижениях: старые строки получают уровень по соответствию кодов.
ALTER TABLE "user_achievements" ADD COLUMN IF NOT EXISTS "level" TEXT NOT NULL DEFAULT 'bronze';

-- Старые коды → новые коды каталога и уровни (остальное доберёт тихий пересчёт при старте).
UPDATE "user_achievements" SET "code" = 'checkin_total', "level" = 'bronze' WHERE "code" = 'first_checkin';
UPDATE "user_achievements" SET "code" = 'checkin_streak', "level" = 'bronze' WHERE "code" = 'checkin_streak_7';
UPDATE "user_achievements" SET "code" = 'checkin_streak', "level" = 'silver' WHERE "code" = 'checkin_streak_30';
UPDATE "user_achievements" SET "code" = 'checkin_streak', "level" = 'gold' WHERE "code" = 'checkin_streak_100';
UPDATE "user_achievements" SET "code" = 'transactions_total', "level" = 'bronze' WHERE "code" = 'first_transaction';
UPDATE "user_achievements" SET "code" = 'budget_closed', "level" = 'bronze' WHERE "code" = 'first_budget_closed';
UPDATE "user_achievements" SET "code" = 'goals_created', "level" = 'bronze' WHERE "code" = 'first_goal';
UPDATE "user_achievements" SET "code" = 'goal_progress', "level" = 'silver' WHERE "code" = 'goal_half';
UPDATE "user_achievements" SET "code" = 'goals_completed', "level" = 'bronze' WHERE "code" = 'goal_complete';

-- 2. Уникальность теперь по (пользователь, код, уровень) — идемпотентная выдача по уровням.
DROP INDEX IF EXISTS "user_achievements_user_id_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "user_achievements_user_id_code_level_key" ON "user_achievements"("user_id", "code", "level");

-- 3. Старый каталог бейджей в справочнике больше не нужен — сервис перезапишет его при старте.
DELETE FROM "achievements";

-- 4. Отпечаток каталога, по которому выполнен тихий пересчёт.
ALTER TABLE "instance_settings" ADD COLUMN IF NOT EXISTS "achievements_catalog_hash" TEXT;

-- Откат 20261007120000_achievements_v3. Идемпотентен (IF EXISTS).
-- Возвращаем старые коды там, где есть однозначное соответствие; остальные новые строки удаляем.
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "achievements_catalog_hash";

UPDATE "user_achievements" SET "code" = 'first_checkin' WHERE "code" = 'checkin_total' AND "level" = 'bronze';
UPDATE "user_achievements" SET "code" = 'checkin_streak_7' WHERE "code" = 'checkin_streak' AND "level" = 'bronze';
UPDATE "user_achievements" SET "code" = 'checkin_streak_30' WHERE "code" = 'checkin_streak' AND "level" = 'silver';
UPDATE "user_achievements" SET "code" = 'checkin_streak_100' WHERE "code" = 'checkin_streak' AND "level" = 'gold';
UPDATE "user_achievements" SET "code" = 'first_transaction' WHERE "code" = 'transactions_total' AND "level" = 'bronze';
UPDATE "user_achievements" SET "code" = 'first_budget_closed' WHERE "code" = 'budget_closed' AND "level" = 'bronze';
UPDATE "user_achievements" SET "code" = 'first_goal' WHERE "code" = 'goals_created' AND "level" = 'bronze';
UPDATE "user_achievements" SET "code" = 'goal_half' WHERE "code" = 'goal_progress' AND "level" = 'silver';
UPDATE "user_achievements" SET "code" = 'goal_complete' WHERE "code" = 'goals_completed' AND "level" = 'bronze';
DELETE FROM "user_achievements" WHERE "code" NOT IN (
  'first_checkin', 'checkin_streak_7', 'checkin_streak_30', 'checkin_streak_100',
  'first_transaction', 'first_budget_closed', 'first_goal', 'goal_half', 'goal_complete'
);

DROP INDEX IF EXISTS "user_achievements_user_id_code_level_key";
ALTER TABLE "user_achievements" DROP COLUMN IF EXISTS "level";
CREATE UNIQUE INDEX IF NOT EXISTS "user_achievements_user_id_code_key" ON "user_achievements"("user_id", "code");
DELETE FROM "achievements";

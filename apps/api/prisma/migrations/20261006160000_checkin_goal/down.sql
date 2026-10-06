-- Откат 20261006160000_checkin_goal.
ALTER TABLE "users" DROP COLUMN IF EXISTS "checkin_weekly_goal";

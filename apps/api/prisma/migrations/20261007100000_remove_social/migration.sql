-- ТЗ-2 §3: удаление функций соцсети. Данные чек-инов, финансов, целей, достижений не затрагиваются.
-- ВНИМАНИЕ: перед применением сделайте бэкап (scripts/backup.sh) — данные соцсети удаляются безвозвратно.

-- Поля User/Goal, нужные только соцсети (nickname/username остаются — нужны для входа).
ALTER TABLE "users" DROP COLUMN IF EXISTS "profile_visibility";
ALTER TABLE "goals" DROP COLUMN IF EXISTS "visibility";

-- Таблицы соцсети (внешние ключи снимаются CASCADE).
DROP TABLE IF EXISTS "follows" CASCADE;
DROP TABLE IF EXISTS "posts" CASCADE;
DROP TABLE IF EXISTS "reactions" CASCADE;
DROP TABLE IF EXISTS "comments" CASCADE;
DROP TABLE IF EXISTS "profiles" CASCADE;
DROP TABLE IF EXISTS "profile_cards" CASCADE;
DROP TABLE IF EXISTS "reports" CASCADE;
DROP TABLE IF EXISTS "moderation_actions" CASCADE;
DROP TABLE IF EXISTS "content_flags" CASCADE;
DROP TABLE IF EXISTS "html_pages" CASCADE;
DROP TABLE IF EXISTS "html_page_versions" CASCADE;
DROP TABLE IF EXISTS "families" CASCADE;
DROP TABLE IF EXISTS "family_members" CASCADE;
DROP TABLE IF EXISTS "family_invites" CASCADE;
DROP TABLE IF EXISTS "family_accounts" CASCADE;
DROP TABLE IF EXISTS "family_transactions" CASCADE;
DROP TABLE IF EXISTS "family_goals" CASCADE;
DROP TABLE IF EXISTS "family_goal_deposits" CASCADE;
DROP TABLE IF EXISTS "challenges" CASCADE;
DROP TABLE IF EXISTS "challenge_participants" CASCADE;
DROP TABLE IF EXISTS "challenge_checks" CASCADE;

-- Правила уведомлений о реакциях подписчиков больше не существуют.
DELETE FROM "notification_rules" WHERE "type" = 'reactions';

-- Типы модерации.
DROP TYPE IF EXISTS "report_target_type";
DROP TYPE IF EXISTS "report_reason";
DROP TYPE IF EXISTS "report_status";
DROP TYPE IF EXISTS "moderation_action_kind";

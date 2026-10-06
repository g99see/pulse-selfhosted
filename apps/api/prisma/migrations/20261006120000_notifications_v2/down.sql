-- Откат 20261006120000_notifications_v2 (схема; данные частично).
-- ВНИМАНИЕ: правила уведомлений, переехавшие из web_push/email в telegram, обратно
-- не разделяются, а подписки push_subscriptions были удалены миграцией безвозвратно
-- (восстанавливается только пустая таблица). Журнал доставок и привязки Discord
-- удаляются вместе с таблицами — сделайте бэкап (скрипт делает его сам).
DROP TABLE IF EXISTS "notification_deliveries";
DROP TABLE IF EXISTS "notification_channel_settings";
DROP TABLE IF EXISTS "discord_link_codes";
DROP TABLE IF EXISTS "discord_links";

ALTER TABLE "telegram_links" DROP COLUMN IF EXISTS "blocked_at";
ALTER TABLE "notification_rules" ALTER COLUMN "channel" SET DEFAULT 'web_push';

CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

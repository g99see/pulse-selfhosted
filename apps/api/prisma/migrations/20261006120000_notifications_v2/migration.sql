-- Уведомления v2: web push удалён, каналы — telegram и discord, outbox доставки.

-- BEGIN web_push_to_telegram
-- Правила с каналами web_push/email переезжают в telegram. Если у пользователя
-- уже есть правило этого типа в telegram — оно приоритетнее, старое удаляется.
DELETE FROM "notification_rules" r
WHERE r."channel" IN ('web_push', 'email')
  AND EXISTS (
    SELECT 1 FROM "notification_rules" t
    WHERE t."user_id" = r."user_id" AND t."type" = r."type" AND t."channel" = 'telegram'
  );

-- Из нескольких старых правил одного типа (web_push и email) оставляем одно.
DELETE FROM "notification_rules" a
USING "notification_rules" b
WHERE a."user_id" = b."user_id" AND a."type" = b."type"
  AND a."channel" IN ('web_push', 'email') AND b."channel" IN ('web_push', 'email')
  AND a."id" > b."id";

UPDATE "notification_rules" SET "channel" = 'telegram' WHERE "channel" IN ('web_push', 'email');
-- END web_push_to_telegram

ALTER TABLE "notification_rules" ALTER COLUMN "channel" SET DEFAULT 'telegram';

-- DropTable
DROP TABLE "push_subscriptions";

-- AlterTable
ALTER TABLE "telegram_links" ADD COLUMN "blocked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "discord_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "discord_user_id" TEXT NOT NULL,
    "dm_channel_id" TEXT NOT NULL,
    "username" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discord_link_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "discord_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channel_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "quiet_hours_start" INTEGER NOT NULL DEFAULT 22,
    "quiet_hours_end" INTEGER NOT NULL DEFAULT 8,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channel_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discord_links_user_id_key" ON "discord_links"("user_id");
CREATE UNIQUE INDEX "discord_links_discord_user_id_key" ON "discord_links"("discord_user_id");
CREATE UNIQUE INDEX "discord_link_codes_code_hash_key" ON "discord_link_codes"("code_hash");
CREATE INDEX "discord_link_codes_user_id_idx" ON "discord_link_codes"("user_id");
CREATE UNIQUE INDEX "notification_channel_settings_user_id_channel_key" ON "notification_channel_settings"("user_id", "channel");
CREATE INDEX "notification_deliveries_status_next_attempt_at_idx" ON "notification_deliveries"("status", "next_attempt_at");
CREATE INDEX "notification_deliveries_user_id_created_at_idx" ON "notification_deliveries"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "discord_links" ADD CONSTRAINT "discord_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discord_link_codes" ADD CONSTRAINT "discord_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_channel_settings" ADD CONSTRAINT "notification_channel_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- BEGIN channel_settings_from_rules
-- Расписание и тихие часы переезжают из правила checkins в настройки канала.
INSERT INTO "notification_channel_settings"
  ("id", "user_id", "channel", "enabled", "schedule", "quiet_hours_start", "quiet_hours_end", "updated_at")
SELECT 'ncs_' || r."id", r."user_id", 'telegram', true,
       jsonb_build_object('times', COALESCE(r."schedule"->'times', '["09:00","15:00","21:00"]'::jsonb), 'summaryTime', '21:30'),
       r."quiet_hours_start", r."quiet_hours_end", CURRENT_TIMESTAMP
FROM "notification_rules" r
WHERE r."type" = 'checkins' AND r."channel" = 'telegram'
ON CONFLICT ("user_id", "channel") DO NOTHING;
-- END channel_settings_from_rules

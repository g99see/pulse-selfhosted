-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Жалобы и модерация (ТЗ §3.7, §3.8): жалобы на профиль/контент, журнал
-- действий модераторов и флаги скрытия целей.

-- CreateEnum
CREATE TYPE "report_target_type" AS ENUM ('profile', 'post', 'comment', 'html_page');

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('spam', 'abuse', 'phishing', 'illegal', 'other');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "moderation_action_kind" AS ENUM ('hide', 'unhide', 'ban_html', 'unban_html', 'dismiss');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_type" "report_target_type" NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" "report_reason" NOT NULL,
    "details" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" TEXT,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_actions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" "moderation_action_kind" NOT NULL,
    "target_type" "report_target_type" NOT NULL,
    "target_id" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_flags" (
    "id" TEXT NOT NULL,
    "target_type" "report_target_type" NOT NULL,
    "target_id" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_target_type_target_id_idx" ON "reports"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "reports_user_id_idx" ON "reports"("user_id");

-- CreateIndex
CREATE INDEX "moderation_actions_target_type_target_id_idx" ON "moderation_actions"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "moderation_actions_user_id_idx" ON "moderation_actions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_flags_target_type_target_id_key" ON "content_flags"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "content_flags_hidden_idx" ON "content_flags"("hidden");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

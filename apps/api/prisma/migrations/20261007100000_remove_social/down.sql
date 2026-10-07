-- Откат 20261007100000_remove_social: пересоздаёт ПУСТЫЕ таблицы и поля соцсети.
-- Данные не возвращаются — их можно восстановить только из бэкапа, сделанного до миграции.

-- CreateEnum
CREATE TYPE "report_target_type" AS ENUM ('profile', 'post', 'comment', 'html_page');

-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('spam', 'abuse', 'phishing', 'illegal', 'other');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'resolved', 'dismissed');

-- CreateEnum
CREATE TYPE "moderation_action_kind" AS ENUM ('hide', 'unhide', 'ban_html', 'unban_html', 'dismiss');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "profile_visibility" TEXT NOT NULL DEFAULT 'private';

-- AlterTable
ALTER TABLE "goals" ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'private';

-- CreateTable
CREATE TABLE "follows" (
    "id" TEXT NOT NULL,
    "follower_id" TEXT NOT NULL,
    "following_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'subscribers',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reactions" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "bio" TEXT,
    "avatar_url" TEXT,
    "cover_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_cards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "mode" TEXT NOT NULL DEFAULT 'percent',
    "title" TEXT,
    "html" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profile_cards_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "html_pages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "html_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "html_page_versions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "note" TEXT,
    "check_status" TEXT NOT NULL DEFAULT 'ok',
    "check_reasons" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "html_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "families" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_invites" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "used_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_accounts" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'card',
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_goals" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "saved_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deadline" DATE,
    "image" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_goal_deposits" (
    "id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_goal_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "duration_days" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "invite_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_participants" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenge_checks" (
    "id" TEXT NOT NULL,
    "challenge_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "challenge_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follows_following_id_idx" ON "follows"("following_id");

-- CreateIndex
CREATE UNIQUE INDEX "follows_follower_id_following_id_key" ON "follows"("follower_id", "following_id");

-- CreateIndex
CREATE INDEX "posts_user_id_created_at_idx" ON "posts"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "posts_created_at_id_idx" ON "posts"("created_at", "id");

-- CreateIndex
CREATE INDEX "reactions_post_id_idx" ON "reactions"("post_id");

-- CreateIndex
CREATE INDEX "reactions_user_id_idx" ON "reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "reactions_post_id_user_id_emoji_key" ON "reactions"("post_id", "user_id", "emoji");

-- CreateIndex
CREATE INDEX "comments_post_id_created_at_idx" ON "comments"("post_id", "created_at");

-- CreateIndex
CREATE INDEX "comments_user_id_idx" ON "comments"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_user_id_key" ON "profiles"("user_id");

-- CreateIndex
CREATE INDEX "profile_cards_user_id_idx" ON "profile_cards"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "profile_cards_user_id_type_key" ON "profile_cards"("user_id", "type");

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
CREATE INDEX "content_flags_hidden_idx" ON "content_flags"("hidden");

-- CreateIndex
CREATE UNIQUE INDEX "content_flags_target_type_target_id_key" ON "content_flags"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "html_pages_user_id_key" ON "html_pages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "html_pages_current_version_id_key" ON "html_pages"("current_version_id");

-- CreateIndex
CREATE INDEX "html_page_versions_page_id_created_at_idx" ON "html_page_versions"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "html_page_versions_user_id_idx" ON "html_page_versions"("user_id");

-- CreateIndex
CREATE INDEX "families_owner_id_idx" ON "families"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_members_user_id_key" ON "family_members"("user_id");

-- CreateIndex
CREATE INDEX "family_members_family_id_idx" ON "family_members"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_invites_code_key" ON "family_invites"("code");

-- CreateIndex
CREATE INDEX "family_invites_family_id_idx" ON "family_invites"("family_id");

-- CreateIndex
CREATE INDEX "family_accounts_family_id_idx" ON "family_accounts"("family_id");

-- CreateIndex
CREATE INDEX "family_transactions_account_id_created_at_idx" ON "family_transactions"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "family_transactions_user_id_date_idx" ON "family_transactions"("user_id", "date");

-- CreateIndex
CREATE INDEX "family_goals_family_id_idx" ON "family_goals"("family_id");

-- CreateIndex
CREATE INDEX "family_goal_deposits_goal_id_idx" ON "family_goal_deposits"("goal_id");

-- CreateIndex
CREATE INDEX "family_goal_deposits_user_id_date_idx" ON "family_goal_deposits"("user_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "challenges_invite_code_key" ON "challenges"("invite_code");

-- CreateIndex
CREATE INDEX "challenges_owner_id_idx" ON "challenges"("owner_id");

-- CreateIndex
CREATE INDEX "challenge_participants_user_id_idx" ON "challenge_participants"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_participants_challenge_id_user_id_key" ON "challenge_participants"("challenge_id", "user_id");

-- CreateIndex
CREATE INDEX "challenge_checks_challenge_id_user_id_idx" ON "challenge_checks"("challenge_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "challenge_checks_challenge_id_user_id_date_key" ON "challenge_checks"("challenge_id", "user_id", "date");

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_fkey" FOREIGN KEY ("follower_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_fkey" FOREIGN KEY ("following_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_cards" ADD CONSTRAINT "profile_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_pages" ADD CONSTRAINT "html_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_pages" ADD CONSTRAINT "html_pages_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "html_page_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_page_versions" ADD CONSTRAINT "html_page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "html_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_page_versions" ADD CONSTRAINT "html_page_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_invites" ADD CONSTRAINT "family_invites_used_by_fkey" FOREIGN KEY ("used_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_accounts" ADD CONSTRAINT "family_accounts_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_transactions" ADD CONSTRAINT "family_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "family_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_transactions" ADD CONSTRAINT "family_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_goals" ADD CONSTRAINT "family_goals_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_goal_deposits" ADD CONSTRAINT "family_goal_deposits_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "family_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_goal_deposits" ADD CONSTRAINT "family_goal_deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_checks" ADD CONSTRAINT "challenge_checks_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_checks" ADD CONSTRAINT "challenge_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


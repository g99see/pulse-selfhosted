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

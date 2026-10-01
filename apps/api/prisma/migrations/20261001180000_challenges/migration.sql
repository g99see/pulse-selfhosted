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
ALTER TABLE "challenges" ADD CONSTRAINT "challenges_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_participants" ADD CONSTRAINT "challenge_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_checks" ADD CONSTRAINT "challenge_checks_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "challenges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "challenge_checks" ADD CONSTRAINT "challenge_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


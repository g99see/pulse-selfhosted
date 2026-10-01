-- CreateTable
CREATE TABLE "insights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text_key" TEXT NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'rule',
    "period_key" TEXT,
    "action" JSONB,
    "applied_at" TIMESTAMP(3),
    "feedback" TEXT,
    "feedback_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insights_user_id_created_at_idx" ON "insights"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "insights_user_id_type_period_key_key" ON "insights"("user_id", "type", "period_key");

-- AddForeignKey
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

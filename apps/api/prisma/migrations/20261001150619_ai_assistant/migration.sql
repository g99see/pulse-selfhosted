-- AlterTable
ALTER TABLE "instance_settings" ADD COLUMN     "ai_api_key_encrypted" TEXT,
ADD COLUMN     "ai_api_key_last4" TEXT,
ADD COLUMN     "ai_base_url" TEXT,
ADD COLUMN     "ai_model" TEXT,
ADD COLUMN     "ai_monthly_token_limit" INTEGER,
ADD COLUMN     "ai_provider" TEXT;

-- CreateTable
CREATE TABLE "user_ai_keys" (
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "api_key_encrypted" TEXT NOT NULL,
    "api_key_last4" TEXT,
    "base_url" TEXT,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_ai_keys_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_user_id_month_key" ON "ai_usage"("user_id", "month");

-- AddForeignKey
ALTER TABLE "user_ai_keys" ADD CONSTRAINT "user_ai_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

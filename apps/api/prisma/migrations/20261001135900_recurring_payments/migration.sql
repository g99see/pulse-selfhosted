-- CreateTable
CREATE TABLE "recurring_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'expense',
    "account_id" TEXT NOT NULL,
    "category_id" TEXT,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "schedule_day" INTEGER NOT NULL,
    "schedule_month" INTEGER,
    "time_of_day" TEXT NOT NULL DEFAULT '10:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "next_run_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "reminded_for" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recurring_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_payments_user_id_active_next_run_at_idx" ON "recurring_payments"("user_id", "active", "next_run_at");

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_payments" ADD CONSTRAINT "recurring_payments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

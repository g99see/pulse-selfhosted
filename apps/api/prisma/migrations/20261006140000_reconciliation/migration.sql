-- Сверка счёта с банком: id операции в банке, время и остаток по выписке,
-- а также таблица балансов по данным банка (выписка или ручной ввод).
ALTER TABLE "transactions" ADD COLUMN "external_id" TEXT;
ALTER TABLE "transactions" ADD COLUMN "bank_time" TEXT;
ALTER TABLE "transactions" ADD COLUMN "bank_balance" DECIMAL(14,2);
CREATE INDEX "transactions_account_id_external_id_idx" ON "transactions"("account_id", "external_id");

CREATE TABLE "account_bank_balances" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL,
    "as_of" DATE NOT NULL,
    "period_from" DATE,
    "period_to" DATE,
    "rows" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_bank_balances_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "account_bank_balances_account_id_created_at_idx" ON "account_bank_balances"("account_id", "created_at");
CREATE INDEX "account_bank_balances_user_id_idx" ON "account_bank_balances"("user_id");
ALTER TABLE "account_bank_balances" ADD CONSTRAINT "account_bank_balances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_bank_balances" ADD CONSTRAINT "account_bank_balances_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

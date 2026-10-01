-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Мультивалютность (ТЗ §3.2): курс валюты операции к основной валюте
-- пользователя на дату операции + справочник курсов.
--
-- Существующие транзакции мигрируют с rate = 1, amount_base = amount
-- (данные «как есть» в основной валюте).

-- AlterTable: зафиксированный курс и сумма в основной валюте.
ALTER TABLE "transactions"
    ADD COLUMN "rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    ADD COLUMN "amount_base" DECIMAL(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN "to_amount" DECIMAL(14,2);

-- Backfill: у уже существующих строк эквивалент в основной валюте равен сумме.
UPDATE "transactions" SET "amount_base" = "amount" WHERE "amount_base" = 0;

-- CreateTable: курсы валют (ручные и подтянутые с публичного API).
CREATE TABLE "exchange_rates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exchange_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "exchange_rates_user_id_date_base_quote_key" ON "exchange_rates"("user_id", "date", "base", "quote");

-- CreateIndex
CREATE INDEX "exchange_rates_user_id_date_idx" ON "exchange_rates"("user_id", "date");

-- AddForeignKey
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

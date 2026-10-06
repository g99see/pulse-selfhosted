-- Отметка «уведомление о расхождении сверки отправлено» — один раз на выписку.
ALTER TABLE "account_bank_balances" ADD COLUMN "mismatch_notified_at" TIMESTAMP(3);

-- Откат 20261006150000_statement_mismatch_notified.
ALTER TABLE "account_bank_balances" DROP COLUMN IF EXISTS "mismatch_notified_at";

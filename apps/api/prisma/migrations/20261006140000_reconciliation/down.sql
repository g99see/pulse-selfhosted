-- Откат 20261006140000_reconciliation: сверка с банком.
-- Удаляются балансы по данным банка и ID/время/остаток операций из выписок.
-- Сами операции и балансы счетов не затрагиваются.
DROP TABLE IF EXISTS "account_bank_balances";
DROP INDEX IF EXISTS "transactions_account_id_external_id_idx";
ALTER TABLE "transactions"
  DROP COLUMN IF EXISTS "external_id",
  DROP COLUMN IF EXISTS "bank_time",
  DROP COLUMN IF EXISTS "bank_balance";

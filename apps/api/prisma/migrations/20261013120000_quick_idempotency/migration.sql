-- QUICK INPUT IDEMPOTENCY (ТЗ §4, docs/MONEY-INPUT.md): быстрый ввод траты
-- через публичный API (iPhone/Shortcuts) должен быть идемпотентным. Ключ
-- приходит заголовком Idempotency-Key, иначе сервер считает
-- sha256(userId|text|date) в окне суток. Повторный запрос находит операцию по
-- ключу и не меняет баланс.
--
-- idempotency_key допускает NULL: у импортированных и созданных вручную
-- операций ключа нет, а PostgreSQL считает NULL-значения уникальными, поэтому
-- несколько строк с NULL сосуществуют.

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_user_id_idempotency_key_key"
  ON "transactions"("user_id", "idempotency_key");

-- УДАЛЕНИЕ ИДЕМПОТЕНТНОСТИ БЫСТРОГО ВВОДА (iPhone/Shortcuts).
--
-- Канал быстрого ввода через публичный API был отклонён и удалён: эндпоинт
-- POST /api/v1/transactions/quick, область токена transactions:quick и логика
-- Idempotency-Key убраны из кода. Колонка и уникальный индекс идемпотентности
-- больше не нужны.
--
-- Миграция 20261013120000_quick_idempotency уже применена в проде, поэтому она
-- НЕ редактируется и НЕ удаляется — откат делается этой отдельной миграцией.

DROP INDEX IF EXISTS "transactions_user_id_idempotency_key_key";

ALTER TABLE "transactions" DROP COLUMN IF EXISTS "idempotency_key";

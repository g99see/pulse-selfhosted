-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Импорт банковской выписки (ТЗ §3.2): хеш строки для идемпотентности
-- повторного импорта одного и того же файла.
ALTER TABLE "transactions" ADD COLUMN "import_hash" TEXT;

CREATE UNIQUE INDEX "transactions_user_id_import_hash_key" ON "transactions"("user_id", "import_hash");

-- SPDX-License-Identifier: AGPL-3.0-or-later
-- v3 §7.2: почта необязательна (нужна только для сброса пароля письмом), а токены
-- установки/сброса пароля (письмо или команда /password в боте) живут в password_tokens.
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
-- Технические адреса аккаунтов из Telegram/Google — не почта: обнуляем.
UPDATE "users" SET "email" = NULL
 WHERE "email" LIKE '%@telegram.invalid' OR "email" LIKE '%@google.invalid';

CREATE TABLE "password_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    CONSTRAINT "password_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "password_tokens_token_hash_key" ON "password_tokens"("token_hash");
CREATE INDEX "password_tokens_user_id_idx" ON "password_tokens"("user_id");
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Двухфакторная аутентификация TOTP (ТЗ §6): зашифрованный секрет на users,
-- одноразовые резервные коды и временные пропуска шага входа.

-- Секрет хранится зашифрованным AES-256-GCM (crypto/secret-box.ts), не в открытом виде.
ALTER TABLE "users" ADD COLUMN "two_fa_secret" TEXT;
ALTER TABLE "users" ADD COLUMN "two_fa_confirmed_at" TIMESTAMP(3);
-- Последний принятый шаг TOTP — против повторного использования кода в окне.
ALTER TABLE "users" ADD COLUMN "two_fa_last_step" INTEGER;

CREATE TABLE "two_factor_backup_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "two_factor_backup_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "two_factor_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "two_factor_backup_codes_user_id_idx" ON "two_factor_backup_codes"("user_id");
CREATE INDEX "two_factor_challenges_user_id_idx" ON "two_factor_challenges"("user_id");
CREATE UNIQUE INDEX "two_factor_challenges_token_hash_key" ON "two_factor_challenges"("token_hash");

ALTER TABLE "two_factor_backup_codes" ADD CONSTRAINT "two_factor_backup_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

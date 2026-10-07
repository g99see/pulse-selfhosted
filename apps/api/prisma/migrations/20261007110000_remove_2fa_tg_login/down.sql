-- Откат 20261007110000_remove_2fa_tg_login: структура 2FA возвращается пустой —
-- секреты и резервные коды удалены безвозвратно, 2FA у всех остаётся выключенной.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_fa_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_fa_secret" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_fa_confirmed_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_fa_last_step" INTEGER;
CREATE TABLE IF NOT EXISTS "two_factor_backup_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMP(3),
    CONSTRAINT "two_factor_backup_codes_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "two_factor_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    CONSTRAINT "two_factor_challenges_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "two_factor_backup_codes_user_id_idx" ON "two_factor_backup_codes"("user_id");
CREATE INDEX IF NOT EXISTS "two_factor_challenges_user_id_idx" ON "two_factor_challenges"("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "two_factor_challenges_token_hash_key" ON "two_factor_challenges"("token_hash");
ALTER TABLE "two_factor_backup_codes" DROP CONSTRAINT IF EXISTS "two_factor_backup_codes_user_id_fkey";
ALTER TABLE "two_factor_backup_codes" ADD CONSTRAINT "two_factor_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "two_factor_challenges" DROP CONSTRAINT IF EXISTS "two_factor_challenges_user_id_fkey";
ALTER TABLE "two_factor_challenges" ADD CONSTRAINT "two_factor_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

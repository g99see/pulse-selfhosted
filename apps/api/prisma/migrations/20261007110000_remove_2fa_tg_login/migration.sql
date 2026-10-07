-- SPDX-License-Identifier: AGPL-3.0-or-later
-- v3 §7.1, §7.3: удаляем 2FA (TOTP, резервные коды, пропуска) — вход только по логину
-- и паролю. Вход через Telegram Login Widget убран из кода; строки external_identities
-- с provider = 'telegram' СОХРАНЯЕМ: по ним бот находит пользователей без пароля и
-- присылает им ссылку установки логина и пароля.
DROP TABLE IF EXISTS "two_factor_backup_codes";
DROP TABLE IF EXISTS "two_factor_challenges";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_fa_enabled";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_fa_secret";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_fa_confirmed_at";
ALTER TABLE "users" DROP COLUMN IF EXISTS "two_fa_last_step";

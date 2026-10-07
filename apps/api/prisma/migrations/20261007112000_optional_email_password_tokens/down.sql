-- Откат 20261007112000_optional_email_password_tokens: у пользователей без почты
-- появляется технический адрес (email снова обязателен и уникален).
DROP TABLE IF EXISTS "password_tokens";
UPDATE "users" SET "email" = 'user-' || "id" || '@restored.invalid' WHERE "email" IS NULL;
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;

-- Приватная ссылка «Итог дня»: в БД только хеш токена.
CREATE TABLE "day_summary_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "day_summary_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "day_summary_links_user_id_key" ON "day_summary_links"("user_id");
CREATE UNIQUE INDEX "day_summary_links_token_hash_key" ON "day_summary_links"("token_hash");
ALTER TABLE "day_summary_links" ADD CONSTRAINT "day_summary_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

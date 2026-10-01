-- HTML-страница профиля (ТЗ §3.8): одна страница на пользователя и история
-- версий (последние 10). Миграция намеренно содержит только эти таблицы:
-- изменения соседних сущностей идут своими миграциями.

-- CreateTable
CREATE TABLE "html_pages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "html_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "html_page_versions" (
    "id" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "note" TEXT,
    "check_status" TEXT NOT NULL DEFAULT 'ok',
    "check_reasons" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "html_page_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "html_pages_user_id_key" ON "html_pages"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "html_pages_current_version_id_key" ON "html_pages"("current_version_id");

-- CreateIndex
CREATE INDEX "html_page_versions_page_id_created_at_idx" ON "html_page_versions"("page_id", "created_at");

-- CreateIndex
CREATE INDEX "html_page_versions_user_id_idx" ON "html_page_versions"("user_id");

-- AddForeignKey
ALTER TABLE "html_pages" ADD CONSTRAINT "html_pages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_pages" ADD CONSTRAINT "html_pages_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "html_page_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_page_versions" ADD CONSTRAINT "html_page_versions_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "html_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "html_page_versions" ADD CONSTRAINT "html_page_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

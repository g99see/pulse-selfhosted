-- Капсула времени (ТЗ §4, P2). Таблица идемпотентна (IF NOT EXISTS): в общем
-- дереве возможна миграция-сосед, создающая time_capsules раньше; повторный
-- прогон не должен падать.
-- CreateTable
CREATE TABLE IF NOT EXISTS "time_capsules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_encrypted" TEXT NOT NULL,
    "snapshot" JSONB,
    "open_at" TIMESTAMP(3) NOT NULL,
    "opened_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_capsules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "time_capsules_user_id_open_at_idx" ON "time_capsules"("user_id", "open_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "time_capsules_opened_at_idx" ON "time_capsules"("opened_at");

-- AddForeignKey
ALTER TABLE "time_capsules" DROP CONSTRAINT IF EXISTS "time_capsules_user_id_fkey";
ALTER TABLE "time_capsules" ADD CONSTRAINT "time_capsules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

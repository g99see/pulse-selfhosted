-- AlterTable
ALTER TABLE "check_ins" ADD COLUMN     "day_summary" TEXT,
ADD COLUMN     "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "slot" TEXT,
ADD COLUMN     "steps" INTEGER,
ADD COLUMN     "water" INTEGER;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "checkin_times" TEXT[] DEFAULT ARRAY['09:00', '15:00', '21:00']::TEXT[],
ADD COLUMN     "checkin_times_per_day" INTEGER NOT NULL DEFAULT 3;

-- CreateIndex
CREATE INDEX "check_ins_user_id_occurred_at_idx" ON "check_ins"("user_id", "occurred_at");

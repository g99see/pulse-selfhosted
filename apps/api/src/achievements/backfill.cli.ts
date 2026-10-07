// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Разовый тихий пересчёт достижений (уведомления не отправляются):
 *   pnpm --filter @puls/api build && node apps/api/dist/achievements/backfill.cli.js
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AchievementsService } from './achievements.service';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const result = await app.get(AchievementsService).backfillAll();
    console.log(`Пересчитано пользователей: ${result.users}, выдано уровней: ${result.awarded}`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger } from '@nestjs/common';
import type { DeleteAccountInput } from '@puls/shared';
import { httpError } from '../common/http-error';
import { PasswordService } from '../auth/password.service';
import { RateLimitService } from '../auth/rate-limit.service';
import { hashToken } from '../auth/tokens';
import { PrismaService } from '../prisma/prisma.service';
import { listUserTables } from './data-registry';

/** Лимиты (ТЗ §6): частые выгрузки и перебор подтверждения удаления тормозим. */
export const EXPORT_LIMIT = 5;
export const DELETE_ATTEMPT_LIMIT = 5;
export const RATE_WINDOW_SECONDS = 15 * 60;

export interface DeletionContext {
  ip?: string;
}

/**
 * Удаление аккаунта (ТЗ §3.1, §6): подтверждение паролем и собственным
 * никнеймом, полное каскадное удаление всех данных пользователя, отзыв сессий
 * и журнал события без персональных данных.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async deleteAccount(userId: string, input: DeleteAccountInput, context: DeletionContext): Promise<void> {
    const limit = await this.rateLimit.consume(
      `account:delete:${userId}`,
      DELETE_ATTEMPT_LIMIT,
      RATE_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      throw httpError(429, 'rate_limited', 'Слишком много попыток удаления. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw httpError(401, 'unauthorized', 'Требуется вход');

    if (input.confirm.trim().toLowerCase() !== user.nickname) {
      throw httpError(400, 'confirmation_mismatch', 'Введите свой никнейм для подтверждения');
    }

    const passwordOk =
      user.passwordHash !== null && (await this.passwords.verify(user.passwordHash, input.password));
    if (!passwordOk) {
      throw httpError(403, 'invalid_password', 'Неверный пароль');
    }

    const removed = await this.purge(userId);

    // Журнал без персональных данных: только необратимый хеш идентификатора.
    this.logger.log(
      `Аккаунт удалён: user=${hashToken(userId).slice(0, 12)} таблиц=${removed.tables} строк=${removed.rows} ip=${context.ip ?? 'unknown'}`,
    );
  }

  /**
   * Полное удаление: все таблицы с user_id по information_schema (поэтому новая
   * таблица удаляется автоматически, даже если реестр выгрузки ещё не обновлён),
   * затем строка users. Всё — в одной транзакции, повторный вызов идемпотентен.
   */
  private async purge(userId: string): Promise<{ tables: number; rows: number }> {
    const tables = await listUserTables(this.prisma);
    let rows = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const table of tables) {
        rows += await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "user_id" = $1`, userId);
      }
      rows += await tx.$executeRawUnsafe('DELETE FROM "users" WHERE "id" = $1', userId);
    });

    return { tables: tables.length + 1, rows };
  }
}

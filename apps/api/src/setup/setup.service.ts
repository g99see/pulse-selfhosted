// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { RegistrationMode, SetupInput, SetupStatusResponse } from '@puls/shared';
import { PasswordService } from '../auth/password.service';
import { toPublicUser, type PublicUser } from '../auth/auth.service';
import { httpError } from '../common/http-error';
import { INSTANCE_SETTINGS_ID } from '../common/instance';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Ключ advisory-блокировки PostgreSQL (ТЗ §6, §9 п.7): сериализует мастер
 * первого запуска, чтобы два одновременных вызова `POST /api/setup` не создали
 * двух администраторов. Блокировка транзакционная — снимается при её завершении.
 */
const SETUP_LOCK_KEY = 0x5075_6c73_5365_7475n; // "PulsSetu"

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

  /** Пока в БД нет ни одного пользователя — нужен мастер первого запуска. */
  async status(): Promise<SetupStatusResponse> {
    const [users, settings] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } }),
    ]);

    return {
      needsSetup: users === 0,
      registrationMode: (settings?.registrationMode as RegistrationMode | undefined) ?? 'open',
    };
  }

  /**
   * Режим регистрации для `AuthService.register` (ТЗ §9 п.7).
   * Строки настроек ещё нет — считаем режим открытым (значение по умолчанию).
   */
  async registrationMode(): Promise<RegistrationMode> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
    });
    return (settings?.registrationMode as RegistrationMode | undefined) ?? 'open';
  }

  /**
   * Создаёт первого администратора. Доступно только на пустом инстансе:
   * как только в БД есть пользователь, метод (и эндпоинт) закрыт навсегда.
   * Гонка двух вызовов разрешается advisory-блокировкой и повторной проверкой
   * счётчика внутри транзакции.
   */
  async createAdmin(input: SetupInput): Promise<PublicUser> {
    const passwordHash = await this.passwords.hash(input.password);

    return this.prisma.$transaction(async (tx) => {
      // pg_advisory_xact_lock возвращает void — Prisma не умеет его
      // десериализовать, поэтому приводим результат к text.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY}::bigint)::text`;

      const users = await tx.user.count();
      if (users > 0) {
        throw httpError(409, 'setup_completed', 'Мастер первого запуска уже пройден');
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          nickname: input.nickname,
          passwordHash,
          locale: input.locale,
          role: 'admin',
          // Первый администратор создаётся доверенным: почта подтверждена сразу,
          // иначе на пустом инстансе без SMTP мастер заблокировал бы сам себя.
          emailVerifiedAt: new Date(),
        },
      });

      const now = new Date();
      await tx.instanceSettings.upsert({
        where: { id: INSTANCE_SETTINGS_ID },
        create: { id: INSTANCE_SETTINGS_ID, setupCompletedAt: now },
        update: { setupCompletedAt: now },
      });

      return toPublicUser(user);
    });
  }
}

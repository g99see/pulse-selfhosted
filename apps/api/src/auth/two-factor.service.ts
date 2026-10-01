// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Двухфакторная аутентификация (ТЗ §6): TOTP-секрет хранится зашифрованным,
 * резервные коды — только хешами, шаг входа между паролем и кодом — временным
 * пропуском. Проверка кода защищена от повторного использования в окне.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { base32Encode } from '../crypto/base32';
import { qrDataUrl, type ErrorCorrection } from '../crypto/qr';
import { SecretBoxService } from '../crypto/secret-box';
import { generateTotpSecret, matchTotpStep, otpauthUri } from '../crypto/totp';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { generateToken, hashToken } from './tokens';

export const ISSUER = 'Puls';
export const BACKUP_CODE_COUNT = 10;
/** Время жизни пропуска шага 2FA между паролем и кодом. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;
/** Допустимое окно TOTP в шагах (RFC 6238 рекомендует ±1). */
export const TOTP_WINDOW = 1;

export interface TwoFactorSetup {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string | null;
  issuer: string;
  account: string;
}

export interface TwoFactorStatus {
  enabled: boolean;
  available: boolean;
}

/**
 * QR строим сами (crypto/qr.ts). Для otpauth-ссылок достаточно L/M; если ссылка
 * не поместилась — отдаём только секрет и URI для ручного ввода.
 */
function buildQr(uri: string): string | null {
  for (const level of ['M', 'L'] as const) {
    try {
      return qrDataUrl(uri, { errorCorrection: level as ErrorCorrection, margin: 2, scale: 4 });
    } catch {
      // пробуем следующий уровень; если и он не подошёл — вернём null
    }
  }
  return null;
}

function generateBackupCode(): string {
  const raw = base32Encode(randomBytes(6)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizeBackupCode(input: string): string | null {
  const normalized = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  return normalized.length === 10 ? normalized : null;
}

function hashBackupCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
    private readonly passwords: PasswordService,
  ) {}

  get available(): boolean {
    return this.secretBox.available;
  }

  status(user: Pick<User, 'twoFaEnabled' | 'twoFaSecret'>): TwoFactorStatus {
    return {
      enabled: user.twoFaEnabled && user.twoFaSecret !== null,
      available: this.available,
    };
  }

  /** Нужен ли второй фактор при входе. */
  requiresTwoFactor(user: Pick<User, 'twoFaEnabled' | 'twoFaSecret'>): boolean {
    return user.twoFaEnabled && user.twoFaSecret !== null;
  }

  private assertAvailable(): void {
    if (!this.available) {
      throw httpError(
        503,
        'two_factor_unavailable',
        'Двухфакторная аутентификация недоступна: не задан APP_ENCRYPTION_KEY',
      );
    }
  }

  /** Шаг 1: создаём секрет, но не включаем 2FA до подтверждения кодом. */
  async setup(user: User): Promise<TwoFactorSetup> {
    this.assertAvailable();
    if (user.twoFaEnabled) {
      throw httpError(409, 'two_factor_enabled', 'Двухфакторная аутентификация уже включена');
    }

    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFaSecret: this.secretBox.encrypt(secret),
        twoFaConfirmedAt: null,
        twoFaLastStep: null,
      },
    });

    const uri = otpauthUri({ secret, issuer: ISSUER, account: user.email });
    return {
      secret,
      otpauthUri: uri,
      qrDataUrl: buildQr(uri),
      issuer: ISSUER,
      account: user.email,
    };
  }

  /** Шаг 2: подтверждаем код и выдаём одноразовые резервные коды. */
  async enable(user: User, code: string): Promise<{ backupCodes: string[] }> {
    this.assertAvailable();
    if (user.twoFaEnabled) {
      throw httpError(409, 'two_factor_enabled', 'Двухфакторная аутентификация уже включена');
    }
    if (!user.twoFaSecret) {
      throw httpError(400, 'two_factor_not_started', 'Сначала начните настройку 2FA');
    }

    const secret = this.decodeSecret(user.twoFaSecret);
    const step = matchTotpStep(secret, code, { window: TOTP_WINDOW });
    if (step === null) {
      throw httpError(400, 'invalid_code', 'Неверный код. Проверьте время на устройстве');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () => generateBackupCode());

    await this.prisma.$transaction([
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.twoFactorBackupCode.createMany({
        data: backupCodes.map((plain) => ({
          userId: user.id,
          codeHash: hashBackupCode(normalizeBackupCode(plain)!),
        })),
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { twoFaEnabled: true, twoFaConfirmedAt: new Date(), twoFaLastStep: step },
      }),
    ]);

    return { backupCodes };
  }

  /** Выключение 2FA: нужен и пароль, и действующий код (или резервный). */
  async disable(user: User, password: string, code: string): Promise<void> {
    this.assertAvailable();
    if (!user.twoFaEnabled || !user.twoFaSecret) {
      throw httpError(400, 'two_factor_not_enabled', 'Двухфакторная аутентификация не включена');
    }

    const passwordOk = user.passwordHash
      ? await this.passwords.verify(user.passwordHash, password)
      : false;
    if (!passwordOk) {
      throw httpError(401, 'invalid_password', 'Неверный пароль');
    }

    const accepted = await this.consumeCode(user, code);
    if (!accepted) {
      throw httpError(400, 'invalid_code', 'Неверный код');
    }

    await this.prisma.$transaction([
      this.prisma.twoFactorBackupCode.deleteMany({ where: { userId: user.id } }),
      this.prisma.twoFactorChallenge.deleteMany({ where: { userId: user.id } }),
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          twoFaEnabled: false,
          twoFaSecret: null,
          twoFaConfirmedAt: null,
          twoFaLastStep: null,
        },
      }),
    ]);
  }

  /** Выдаёт временный пропуск для шага ввода кода после проверки пароля. */
  async createChallenge(userId: string): Promise<string> {
    const token = generateToken();
    await this.prisma.twoFactorChallenge.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000),
      },
    });
    return token;
  }

  /** Проверяет код по пропуску; при успехе пропуск гасится (одноразовый). */
  async consumeChallenge(token: string, code: string): Promise<User> {
    const challenge = await this.prisma.twoFactorChallenge.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!challenge || challenge.usedAt !== null || challenge.expiresAt.getTime() <= Date.now()) {
      throw httpError(401, 'invalid_challenge', 'Вход устарел. Войдите заново');
    }

    const accepted = await this.consumeCode(challenge.user, code);
    if (!accepted) {
      throw httpError(401, 'invalid_code', 'Неверный код');
    }

    await this.prisma.twoFactorChallenge.update({
      where: { id: challenge.id },
      data: { usedAt: new Date() },
    });

    return challenge.user;
  }

  /** TOTP-код (с защитой от повтора) или резервный код (одноразовый). */
  private async consumeCode(user: User, code: string): Promise<boolean> {
    if (user.twoFaSecret) {
      const secret = this.tryDecodeSecret(user.twoFaSecret);
      if (secret) {
        const step = matchTotpStep(secret, code, { window: TOTP_WINDOW });
        if (step !== null && step > (user.twoFaLastStep ?? -1)) {
          await this.prisma.user.update({
            where: { id: user.id },
            data: { twoFaLastStep: step },
          });
          return true;
        }
      }
    }
    return this.consumeBackupCode(user.id, code);
  }

  private async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const normalized = normalizeBackupCode(code);
    if (!normalized) return false;

    const result = await this.prisma.twoFactorBackupCode.updateMany({
      where: { userId, codeHash: hashBackupCode(normalized), usedAt: null },
      data: { usedAt: new Date() },
    });
    return result.count > 0;
  }

  private decodeSecret(encrypted: string): string {
    try {
      return this.secretBox.decrypt(encrypted);
    } catch {
      throw httpError(500, 'two_factor_secret_corrupt', 'Не удалось прочитать секрет 2FA');
    }
  }

  private tryDecodeSecret(encrypted: string): string | null {
    try {
      return this.secretBox.decrypt(encrypted);
    } catch {
      return null;
    }
  }
}

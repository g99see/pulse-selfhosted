// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger } from '@nestjs/common';
import argon2 from 'argon2';

export interface Argon2Settings {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Хеширование паролей Argon2id (ТЗ §6). Параметры по умолчанию — минимум
 * OWASP (19 МиБ, t=2, p=1), в тестах снижаются переменными окружения.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private readonly settings: Argon2Settings;

  constructor() {
    this.settings = {
      memoryCost: Number(process.env.ARGON2_MEMORY_COST ?? 19_456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id, ...this.settings });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch (error) {
      this.logger.warn(
        `Проверка пароля не удалась: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return false;
    }
  }

  /** Полный пересчёт не нужен, но полезно для тестов и защиты: нужен ли rehash. */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, this.settings);
    } catch {
      return true;
    }
  }
}

// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { SecretBoxService } from './secret-box';

/** AES-256-GCM «сейф» секретов (ТЗ §6): AI-ключи и токены. */
@Module({
  providers: [SecretBoxService],
  exports: [SecretBoxService],
})
export class CryptoModule {}

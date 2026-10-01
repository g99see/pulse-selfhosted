// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  let service: PasswordService;

  beforeAll(() => {
    // В тестах снижаем стоимость Argon2 — проверяем алгоритм, а не скорость.
    process.env.ARGON2_MEMORY_COST = '4096';
    process.env.ARGON2_TIME_COST = '1';
    process.env.ARGON2_PARALLELISM = '1';
    service = new PasswordService();
  });

  it('hashes with Argon2id and verifies the original password', async () => {
    const hash = await service.hash('Secret12345');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    await expect(service.verify(hash, 'Secret12345')).resolves.toBe(true);
  });

  it('salts every hash, so equal passwords produce different digests', async () => {
    const [a, b] = await Promise.all([service.hash('Secret12345'), service.hash('Secret12345')]);
    expect(a).not.toBe(b);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('Secret12345');
    await expect(service.verify(hash, 'Secret12346')).resolves.toBe(false);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    await expect(service.verify('not-a-hash', 'Secret12345')).resolves.toBe(false);
  });
});

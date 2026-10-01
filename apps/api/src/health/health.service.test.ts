// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { HealthService } from './health.service';
import type { PrismaService } from '../prisma/prisma.service';

function serviceWith(isHealthy: boolean): HealthService {
  const prisma = { isHealthy: vi.fn().mockResolvedValue(isHealthy) } as unknown as PrismaService;
  return new HealthService(prisma);
}

describe('HealthService', () => {
  it('reports ok when the database responds', async () => {
    const report = await serviceWith(true).check();
    expect(report.status).toBe('ok');
    expect(report.db).toBe('up');
    expect(report.version).toBeTruthy();
    expect(Number.isInteger(report.uptimeSeconds)).toBe(true);
    expect(() => new Date(report.timestamp).toISOString()).not.toThrow();
  });

  it('reports degraded when the database is unreachable', async () => {
    const report = await serviceWith(false).check();
    expect(report.status).toBe('degraded');
    expect(report.db).toBe('down');
  });
});

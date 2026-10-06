// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable } from '@nestjs/common';
import type { NotificationMetricsResponse } from '@puls/shared';
import { OutboxService } from '../notifications/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { runtimeStats } from './runtime-stats';

export interface AdminMetricsResponse {
  startedAt: string;
  uptimeSeconds: number;
  errorsSinceStart: number;
  lastSchedulerRunAt: string | null;
  /** Доставки по статусам и каналам (метрики outbox). */
  deliveries: NotificationMetricsResponse;
  /** Длина очереди: записи outbox в статусе queued. */
  queueLength: number;
}

@Injectable()
export class MetricsService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly prisma: PrismaService,
  ) {}

  async collect(): Promise<AdminMetricsResponse> {
    const [deliveries, queueLength] = await Promise.all([
      this.outbox.metrics(),
      this.prisma.notificationDelivery.count({ where: { status: 'queued' } }),
    ]);
    const stats = runtimeStats.snapshot();
    return {
      ...stats,
      uptimeSeconds: Math.round((Date.now() - Date.parse(stats.startedAt)) / 1000),
      deliveries,
      queueLength,
    };
  }
}

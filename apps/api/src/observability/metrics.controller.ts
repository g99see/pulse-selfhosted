// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../moderation/roles.guard';
import { Roles } from '../moderation/roles.decorator';
import { MetricsService } from './metrics.service';

/** Метрики экземпляра: только admin. */
@Controller('admin/metrics')
@UseGuards(SessionGuard, RolesGuard)
@Roles('admin')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  get() {
    return this.metrics.collect();
  }
}

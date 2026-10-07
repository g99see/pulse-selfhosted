// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
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

// SPDX-License-Identifier: AGPL-3.0-or-later
import { Module } from '@nestjs/common';
import { GoalWidgetService } from './goal-widget.service';
import { WidgetsController } from './widgets.controller';

/**
 * Виджет цели (ТЗ §4, P3): публичный модуль без сессии. PrismaService —
 * глобальный провайдер, поэтому импортов у модуля нет.
 */
@Module({
  controllers: [WidgetsController],
  providers: [GoalWidgetService],
})
export class WidgetsModule {}

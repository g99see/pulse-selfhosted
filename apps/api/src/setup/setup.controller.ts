// SPDX-License-Identifier: AGPL-3.0-or-later
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  SetupSchema,
  type SetupInput,
  type SetupResponse,
  type SetupStatusResponse,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SetupService } from './setup.service';

/**
 * Мастер первого запуска (ТЗ §9 п.7, §10): пока инстанс пуст, `GET /api/setup/status`
 * сообщает об этом, а `POST /api/setup` создаёт первого администратора.
 * Мутирующий запрос защищён глобальным CsrfGuard (ТЗ §6).
 */
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  status(): Promise<SetupStatusResponse> {
    return this.setup.status();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(SetupSchema)) body: SetupInput): Promise<SetupResponse> {
    const user = await this.setup.createAdmin(body);
    return { user };
  }
}

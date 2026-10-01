// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  CapsuleCreateSchema,
  type CapsuleCreateInput,
  type CapsuleDetailDto,
  type CapsulesListResponse,
} from '@puls/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { SessionGuard } from '../auth/session.guard';
import { httpError } from '../common/http-error';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CapsulesService } from './capsules.service';

/**
 * Капсулы времени (ТЗ §4, P2): создание письма себе, список, просмотр после
 * открытия и удаление. Все эндпоинты под SessionGuard и работают только со
 * своими капсулами; до open_at тело письма и статистика не отдаются.
 */
@Controller('capsules')
@UseGuards(SessionGuard)
export class CapsulesController {
  constructor(private readonly capsules: CapsulesService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest): Promise<CapsulesListResponse> {
    return { capsules: await this.capsules.list(req.user!.id) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(new ZodValidationPipe(CapsuleCreateSchema)) body: CapsuleCreateInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<CapsuleDetailDto> {
    return this.capsules.create(req.user!.id, body);
  }

  @Get(':id')
  detail(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<CapsuleDetailDto> {
    return this.capsules.detail(req.user!.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<void> {
    await this.capsules.remove(req.user!.id, id);
  }

  /** Только для dev/e2e: открыть капсулу сразу, не дожидаясь open_at. */
  @Post(':id/dev-open')
  devOpen(@Param('id') id: string, @Req() req: AuthenticatedRequest): Promise<CapsuleDetailDto> {
    if (process.env.NODE_ENV === 'production') {
      throw httpError(404, 'not_found', 'Не найдено');
    }
    return this.capsules.openNow(req.user!.id, id);
  }
}

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
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { HTML_PAGE_MAX_BYTES, HtmlPageSaveSchema, type HtmlPageSaveInput } from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { httpError } from '../common/http-error';
import { SessionGuard } from '../auth/session.guard';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { HtmlPageService } from './html-page.service';

/** Загруженный файл (минимальный срез multer — без @types/multer). */
interface UploadedHtmlFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * HTML-страница в профиле (ТЗ §3.8): чтение, сохранение новой версии, загрузка
 * файла, история версий с откатом и удаление. Всё под серверной сессией, данные
 * только текущего пользователя.
 */
@Controller('html-page')
@UseGuards(SessionGuard)
export class HtmlPageController {
  constructor(private readonly pages: HtmlPageService) {}

  @Get()
  async get(@Req() req: AuthenticatedRequest) {
    const user = req.user!;
    return { page: await this.pages.get(user.id, user.nickname) };
  }

  @Get('versions')
  async versions(@Req() req: AuthenticatedRequest) {
    return { versions: await this.pages.listVersions(req.user!.id) };
  }

  /** Сохранение = новая версия (ТЗ §3.8). */
  @Put()
  async save(
    @Body(new ZodValidationPipe(HtmlPageSaveSchema)) body: HtmlPageSaveInput,
    @Req() req: AuthenticatedRequest,
  ) {
    const user = req.user!;
    return { page: await this.pages.save(user.id, user.nickname, body) };
  }

  /** Загрузка одного .html до 2 МБ (ТЗ §3.8). */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: HTML_PAGE_MAX_BYTES } }))
  async upload(
    @UploadedFile() file: UploadedHtmlFile | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    if (!file?.buffer) {
      throw httpError(400, 'file_required', 'Прикрепите файл .html');
    }
    const user = req.user!;
    return { page: await this.pages.upload(user.id, user.nickname, file) };
  }

  /** Откат к версии: создаёт новую версию, история не теряется (ТЗ §3.8). */
  @Post('versions/:id/restore')
  @HttpCode(HttpStatus.CREATED)
  async restore(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const user = req.user!;
    return { page: await this.pages.restore(user.id, user.nickname, id) };
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: AuthenticatedRequest): Promise<void> {
    await this.pages.remove(req.user!.id);
  }
}

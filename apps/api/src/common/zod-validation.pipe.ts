// SPDX-License-Identifier: AGPL-3.0-or-later
import { HttpException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

/**
 * Валидация тела запроса zod-схемами из @puls/shared (ТЗ §7: общая валидация).
 * При ошибке отдаём единый формат: { code: 'validation_error', issues }.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new HttpException(
        {
          code: 'validation_error',
          message: 'Проверьте заполненные поля',
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        400,
      );
    }

    return result.data;
  }
}

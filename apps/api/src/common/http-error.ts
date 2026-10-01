// SPDX-License-Identifier: AGPL-3.0-or-later
import { HttpException } from '@nestjs/common';

/** Единый формат ошибок API: { code, message, ...extra }. */
export function httpError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): HttpException {
  return new HttpException({ code, message, ...extra }, status);
}

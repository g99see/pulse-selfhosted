// SPDX-License-Identifier: AGPL-3.0-or-later
import { Controller, Get, Param, Req } from '@nestjs/common';
import type { Request } from 'express';
import { SESSION_COOKIE } from '../auth/cookies';
import { SessionService } from '../auth/session.service';
import { ProfileService } from './profile.service';

/**
 * Публичный просмотр профиля (ТЗ §3.7): /api/public/profiles/:nickname.
 * Доступ без входа; если есть активная сессия — она учитывается как смотрящий
 * (владелец видит свои скрытые карточки, подписчик — карточки для подписчиков).
 */
@Controller('public/profiles')
export class PublicProfilesController {
  constructor(
    private readonly profile: ProfileService,
    private readonly sessions: SessionService,
  ) {}

  /** Необязательный смотрящий: cookie-сессия либо аноним. */
  private async resolveViewerId(req: Request): Promise<string | null> {
    const token = (req.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE];
    if (!token) return null;
    const resolved = await this.sessions.resolve(token);
    return resolved?.user.id ?? null;
  }

  @Get(':nickname')
  async get(@Param('nickname') nickname: string, @Req() req: Request) {
    const viewerId = await this.resolveViewerId(req);
    return { profile: await this.profile.getPublic(nickname, viewerId) };
  }
}

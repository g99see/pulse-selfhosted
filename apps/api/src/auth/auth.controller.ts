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
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ForgotPasswordSchema,
  LoginSchema,
  OnboardingSchema,
  PasswordTokenSchema,
  RegisterSchema,
  ResendVerificationSchema,
  VerifyEmailSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type OnboardingInput,
  type PasswordTokenInput,
  type RegisterInput,
} from '@puls/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { httpError } from '../common/http-error';
import { toPublicUser, AuthService } from './auth.service';
import { needsEmail } from './external/external-auth.service';
import type { AuthenticatedRequest } from './auth.types';
import {
  clearCookieOptions,
  CSRF_COOKIE,
  csrfCookieOptions,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './cookies';
import { MailService } from './mail.service';
import { RateLimitService } from './rate-limit.service';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { generateToken } from './tokens';
import { PasswordResetService } from './password-reset.service';

const LOGIN_NAME_LIMIT = 5;
const LOGIN_IP_LIMIT = 100;
const RESEND_LIMIT = 10;
const NICKNAME_CHECK_LIMIT = 60;
const PASSWORD_RESET_LIMIT = 5;
const PASSWORD_TOKEN_IP_LIMIT = 20;
const WINDOW_SECONDS = 15 * 60;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /** Выдаёт CSRF-cookie; web вызывает при загрузке формы (ТЗ §6). */
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    const token = generateToken();
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
    return { csrfToken: token };
  }

  /** Регистрация: логин + пароль (+ почта); сразу выдаёт сессию (v3 §7.2). */
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, token, expiresAt, verificationSent } = await this.auth.register(
      body,
      contextOf(req),
    );
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return { user, verificationSent };
  }

  /** Живая проверка доступности логина на форме регистрации. */
  @Get('nickname-available')
  async nicknameAvailable(
    @Query('nickname') nickname: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limit(`nickname:ip:${req.ip ?? 'unknown'}`, NICKNAME_CHECK_LIMIT, res);
    return this.auth.nicknameAvailability(String(nickname ?? ''));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: ReturnType<typeof toPublicUser> }> {
    await this.enforceLoginRateLimit(req, body.login, res);
    const outcome = await this.auth.login(body, contextOf(req));
    await this.rateLimit.reset(`login:name:${body.login}`);

    res.cookie(SESSION_COOKIE, outcome.token, sessionCookieOptions(outcome.expiresAt));
    return { user: outcome.user };
  }

  /** Письмо со ссылкой сброса пароля (если у пользователя есть почта и настроен SMTP). */
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(ForgotPasswordSchema)) body: ForgotPasswordInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ sent: true }> {
    await this.limit(`forgot:ip:${req.ip ?? 'unknown'}`, PASSWORD_RESET_LIMIT, res);
    await this.limit(`forgot:login:${body.login}`, PASSWORD_RESET_LIMIT, res);
    await this.passwordReset.requestByMail(body.login);
    // Ответ одинаков всегда — не раскрываем, есть ли такой пользователь и почта.
    return { sent: true };
  }

  /** Что за токеном пароля: действителен ли и нужно ли задавать логин. */
  @Get('password-token')
  async passwordToken(
    @Query('token') token: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.limit(`pwtoken:ip:${req.ip ?? 'unknown'}`, PASSWORD_TOKEN_IP_LIMIT, res);
    return this.passwordReset.info(String(token ?? ''));
  }

  /** Установка/сброс пароля по токену (письмо или бот); завершает все сессии. */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body(new ZodValidationPipe(PasswordTokenSchema)) body: PasswordTokenInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: ReturnType<typeof toPublicUser> }> {
    await this.limit(`pwtoken:ip:${req.ip ?? 'unknown'}`, PASSWORD_TOKEN_IP_LIMIT, res);
    const { userId } = await this.passwordReset.consume(body.token, body.password, body.nickname);
    const { user, token, expiresAt } = await this.auth.openSession(userId, contextOf(req));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return { user };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(VerifyEmailSchema)) body: { token: string },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: ReturnType<typeof toPublicUser> }> {
    const { user, token, expiresAt } = await this.auth.verifyEmail(body.token, contextOf(req));
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return { user };
  }

  @Post('verify-email/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(
    @Body(new ZodValidationPipe(ResendVerificationSchema)) body: { email: string },
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ sent: true }> {
    const limit = await this.rateLimit.consume(
      `resend:ip:${req.ip ?? 'unknown'}`,
      RESEND_LIMIT,
      WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      throw httpError(429, 'rate_limited', 'Слишком много запросов. Попробуйте позже', {
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }

    await this.auth.resendVerification(body.email);
    return { sent: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  me(@Req() req: AuthenticatedRequest) {
    const user = req.user!;
    return {
      user: toPublicUser(user),
      onboardingCompleted: user.onboardingCompletedAt !== null,
      needsEmail: needsEmail(user),
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.sessions.revoke(req.user!.id, req.session!.id);
    res.clearCookie(SESSION_COOKIE, clearCookieOptions());
  }

  @Get('sessions')
  @UseGuards(SessionGuard)
  async listSessions(@Req() req: AuthenticatedRequest): Promise<{ sessions: unknown[] }> {
    const sessions = await this.sessions.list(req.user!.id, req.session!.id);
    return { sessions };
  }

  /** «Выйти из всех сессий»: завершает все входы, кроме текущего. */
  @Delete('sessions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  async revokeOtherSessions(@Req() req: AuthenticatedRequest): Promise<{ revoked: number }> {
    return { revoked: await this.sessions.revokeAll(req.user!.id, req.session!.id) };
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async revokeSession(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const revoked = await this.sessions.revoke(req.user!.id, id);
    if (!revoked) {
      throw httpError(404, 'session_not_found', 'Сессия не найдена');
    }
    if (id === req.session!.id) {
      res.clearCookie(SESSION_COOKIE, clearCookieOptions());
    }
  }

  @Put('onboarding')
  @UseGuards(SessionGuard)
  async completeOnboarding(
    @Body(new ZodValidationPipe(OnboardingSchema)) body: OnboardingInput,
    @Req() req: AuthenticatedRequest,
  ) {
    const { user, accounts } = await this.auth.completeOnboarding(req.user!.id, body);
    return {
      user,
      onboardingCompleted: true,
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.name,
        type: account.type,
        currency: account.currency,
        balance: Number(account.balance),
      })),
    };
  }

  /** Только для dev/e2e: последние письма из in-memory транспорта. */
  @Get('dev/outbox')
  outbox(): { messages: readonly unknown[] } {
    if (process.env.NODE_ENV === 'production') {
      throw httpError(404, 'not_found', 'Не найдено');
    }
    return { messages: this.mail.outbox() };
  }

  /** Общий лимит по ключу: 429 с Retry-After при превышении. */
  private async limit(key: string, max: number, res: Response): Promise<void> {
    const result = await this.rateLimit.consume(key, max, WINDOW_SECONDS);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw httpError(429, 'rate_limited', 'Слишком много запросов. Попробуйте позже', {
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }
  }

  private async enforceLoginRateLimit(
    req: AuthenticatedRequest,
    login: string,
    res: Response,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const [byEmail, byIp] = await Promise.all([
      this.rateLimit.consume(`login:name:${login}`, LOGIN_NAME_LIMIT, WINDOW_SECONDS),
      this.rateLimit.consume(`login:ip:${ip}`, LOGIN_IP_LIMIT, WINDOW_SECONDS),
    ]);

    if (!byEmail.allowed || !byIp.allowed) {
      const retryAfterSeconds = Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      throw httpError(429, 'rate_limited', 'Слишком много попыток входа. Попробуйте позже', {
        retryAfterSeconds,
      });
    }
  }
}

function contextOf(req: AuthenticatedRequest): { userAgent?: string; ip?: string } {
  const userAgent = req.headers['user-agent'];
  return {
    userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
    ip: req.ip,
  };
}

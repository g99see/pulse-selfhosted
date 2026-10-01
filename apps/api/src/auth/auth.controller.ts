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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  LoginSchema,
  OnboardingSchema,
  RegisterSchema,
  ResendVerificationSchema,
  TwoFactorDisableSchema,
  TwoFactorEnableSchema,
  TwoFactorLoginSchema,
  VerifyEmailSchema,
  type LoginInput,
  type OnboardingInput,
  type RegisterInput,
  type TwoFactorDisableInput,
  type TwoFactorEnableInput,
  type TwoFactorLoginInput,
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
import { TwoFactorService } from './two-factor.service';

const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_IP_LIMIT = 100;
const RESEND_LIMIT = 10;
/** Лимит попыток ввода второго фактора (ТЗ §6): на пропуск и на IP. */
const TWO_FACTOR_ATTEMPT_LIMIT = 5;
const TWO_FACTOR_IP_LIMIT = 20;
const WINDOW_SECONDS = 15 * 60;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly rateLimit: RateLimitService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /** Выдаёт CSRF-cookie; web вызывает при загрузке формы (ТЗ §6). */
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response): { csrfToken: string } {
    const token = generateToken();
    res.cookie(CSRF_COOKIE, token, csrfCookieOptions());
    return { csrfToken: token };
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<
    { user: ReturnType<typeof toPublicUser> } | { twoFactorRequired: true; challengeToken: string }
  > {
    await this.enforceLoginRateLimit(req, body.email, res);
    const outcome = await this.auth.login(body, contextOf(req));
    await this.rateLimit.reset(`login:email:${body.email}`);

    // Включена 2FA: пароль верен, но сессию выдаём только после второго шага.
    if ('twoFactorRequired' in outcome) {
      return outcome;
    }

    res.cookie(SESSION_COOKIE, outcome.token, sessionCookieOptions(outcome.expiresAt));
    return { user: outcome.user };
  }

  /** Второй шаг входа (ТЗ §6): код TOTP или одноразовый резервный код. */
  @Post('login/2fa')
  @HttpCode(HttpStatus.OK)
  async loginTwoFactor(
    @Body(new ZodValidationPipe(TwoFactorLoginSchema)) body: TwoFactorLoginInput,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: ReturnType<typeof toPublicUser> }> {
    await this.enforceTwoFactorRateLimit(req, body.challengeToken, res);
    const { user, token, expiresAt } = await this.auth.loginWithTwoFactor(
      body.challengeToken,
      body.code,
      contextOf(req),
    );
    res.cookie(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    return { user };
  }

  /** Статус 2FA для настроек (ТЗ §6). */
  @Get('2fa')
  @UseGuards(SessionGuard)
  twoFactorStatus(@Req() req: AuthenticatedRequest) {
    return this.twoFactor.status(req.user!);
  }

  /** Начало настройки: секрет, otpauth:// URI и QR (ТЗ §6). */
  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  setupTwoFactor(@Req() req: AuthenticatedRequest) {
    return this.twoFactor.setup(req.user!);
  }

  /** Подтверждение кода: включает 2FA и выдаёт резервные коды. */
  @Post('2fa/enable')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionGuard)
  enableTwoFactor(
    @Body(new ZodValidationPipe(TwoFactorEnableSchema)) body: TwoFactorEnableInput,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.twoFactor.enable(req.user!, body.code);
  }

  /** Выключение 2FA: требует пароль и действующий код. */
  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SessionGuard)
  async disableTwoFactor(
    @Body(new ZodValidationPipe(TwoFactorDisableSchema)) body: TwoFactorDisableInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.twoFactor.disable(req.user!, body.password, body.code);
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
    // needsEmail: аккаунт из Telegram с техническим адресом — UI мягко предложит
    // указать настоящий email (ТЗ §3.1, §7).
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

  private async enforceTwoFactorRateLimit(
    req: AuthenticatedRequest,
    challengeToken: string,
    res: Response,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const [byChallenge, byIp] = await Promise.all([
      this.rateLimit.consume(
        `login2fa:challenge:${challengeToken}`,
        TWO_FACTOR_ATTEMPT_LIMIT,
        WINDOW_SECONDS,
      ),
      this.rateLimit.consume(`login2fa:ip:${ip}`, TWO_FACTOR_IP_LIMIT, WINDOW_SECONDS),
    ]);

    if (!byChallenge.allowed || !byIp.allowed) {
      const retryAfterSeconds = Math.max(byChallenge.retryAfterSeconds, byIp.retryAfterSeconds);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      throw httpError(429, 'rate_limited', 'Слишком много попыток. Попробуйте позже', {
        retryAfterSeconds,
      });
    }
  }

  private async enforceLoginRateLimit(
    req: AuthenticatedRequest,
    email: string,
    res: Response,
  ): Promise<void> {
    const ip = req.ip ?? 'unknown';
    const [byEmail, byIp] = await Promise.all([
      this.rateLimit.consume(`login:email:${email}`, LOGIN_EMAIL_LIMIT, WINDOW_SECONDS),
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

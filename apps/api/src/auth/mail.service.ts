// SPDX-License-Identifier: AGPL-3.0-or-later
import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  kind?: string;
  link?: string;
  sentAt?: string;
}

export interface MailTransport {
  send(mail: OutgoingMail): Promise<void>;
}

/** Транспорт для dev и тестов (ТЗ §7): письма никуда не уходят, их видно в outbox. */
export class InMemoryMailTransport implements MailTransport {
  readonly messages: OutgoingMail[] = [];

  async send(mail: OutgoingMail): Promise<void> {
    this.messages.push({ ...mail, sentAt: mail.sentAt ?? new Date().toISOString() });
  }

  lastFor(to: string): OutgoingMail | undefined {
    return [...this.messages].reverse().find((mail) => mail.to === to);
  }

  clear(): void {
    this.messages.length = 0;
  }
}

export class SmtpMailTransport implements MailTransport {
  constructor(
    private readonly transporter: Transporter,
    private readonly from: string,
  ) {}

  async send(mail: OutgoingMail): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
  }
}

const VERIFY_LINK_RE = /verify-email\?token=([A-Za-z0-9_-]+)/;

/**
 * Письма подтверждения email (ТЗ §3.1, §6). По умолчанию — in-memory
 * (dev/тесты); реальная отправка включается переменной MAIL_TRANSPORT=smtp.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: MailTransport;
  private readonly from: string;
  private readonly webAppUrl: string;

  constructor() {
    this.from = process.env.MAIL_FROM ?? 'Пульс <no-reply@localhost>';
    this.webAppUrl = (process.env.WEB_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
    this.transport = this.createTransport();
  }

  private createTransport(): MailTransport {
    const kind = process.env.MAIL_TRANSPORT ?? (process.env.SMTP_URL ? 'smtp' : 'console');

    if (kind === 'smtp' && process.env.SMTP_URL) {
      this.logger.log('Письма отправляются через SMTP');
      return new SmtpMailTransport(nodemailer.createTransport(process.env.SMTP_URL), this.from);
    }

    if (kind === 'smtp') {
      this.logger.warn('MAIL_TRANSPORT=smtp, но SMTP_URL не задан — письма уходят в outbox');
    }
    return new InMemoryMailTransport();
  }

  async sendEmailVerification(to: string, token: string): Promise<void> {
    const link = `${this.webAppUrl}/verify-email?token=${token}`;
    const subject = 'Пульс: подтвердите email';
    const text =
      `Здравствуйте!\n\n` +
      `Подтвердите адрес, чтобы включить аккаунт «Пульса»:\n${link}\n\n` +
      `Ссылка действует 24 часа. Если вы не регистрировались, просто проигнорируйте это письмо.`;

    await this.transport.send({
      to,
      subject,
      text,
      html: `<p>Здравствуйте!</p><p>Подтвердите адрес, чтобы включить аккаунт «Пульса»:</p><p><a href="${link}">${link}</a></p><p>Ссылка действует 24 часа.</p>`,
      kind: 'email-verification',
      link,
    });

    if (this.transport instanceof InMemoryMailTransport) {
      this.logger.log(`[dev] Письмо подтверждения для ${to}: ${link}`);
    }
  }

  /** Уведомление по email (ТЗ §3.6, канал email): чек-ины, отчёты, реакции. */
  async sendNotification(
    to: string,
    notification: { subject: string; text: string; html?: string; kind?: string; link?: string },
  ): Promise<void> {
    await this.transport.send({ to, ...notification });

    if (this.transport instanceof InMemoryMailTransport) {
      this.logger.log(`[dev] Уведомление для ${to}: ${notification.subject}`);
    }
  }

  /** outbox доступен только для in-memory транспорта (dev/e2e). */
  outbox(): readonly OutgoingMail[] {
    return this.transport instanceof InMemoryMailTransport ? this.transport.messages : [];
  }

  clearOutbox(): void {
    if (this.transport instanceof InMemoryMailTransport) {
      this.transport.clear();
    }
  }

  lastVerificationTokenFor(to: string): string | undefined {
    const mail = [...this.outbox()]
      .reverse()
      .find((m) => m.to === to && m.kind === 'email-verification');
    const match = mail ? VERIFY_LINK_RE.exec(mail.link ?? mail.text) : null;
    return match?.[1];
  }
}

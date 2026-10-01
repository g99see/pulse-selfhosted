// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { InMemoryMailTransport, MailService } from './mail.service';

describe('InMemoryMailTransport', () => {
  it('records messages and returns the newest per recipient', async () => {
    const transport = new InMemoryMailTransport();
    await transport.send({ to: 'a@b.co', subject: 'Первый', text: '1' });
    await transport.send({ to: 'a@b.co', subject: 'Второй', text: '2' });
    await transport.send({ to: 'c@d.co', subject: 'Другому', text: '3' });

    expect(transport.messages).toHaveLength(3);
    expect(transport.lastFor('a@b.co')?.subject).toBe('Второй');
    expect(transport.lastFor('c@d.co')?.subject).toBe('Другому');
    expect(transport.lastFor('nobody@x.co')).toBeUndefined();
  });

  it('clears recorded messages', async () => {
    const transport = new InMemoryMailTransport();
    await transport.send({ to: 'a@b.co', subject: 's', text: 't' });
    transport.clear();
    expect(transport.messages).toHaveLength(0);
  });
});

describe('MailService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults to the in-memory transport in dev and captures the letter', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    process.env.WEB_APP_URL = 'http://localhost:3000';
    const service = new MailService();

    await service.sendEmailVerification('user@example.com', 'tok_123');

    const mail = service.outbox().at(-1);
    expect(mail?.to).toBe('user@example.com');
    expect(mail?.subject).toMatch(/подтверди/i);
    expect(mail?.text).toContain('http://localhost:3000/verify-email?token=tok_123');
  });

  it('extracts the verification token from the sent link (для e2e/dev)', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    process.env.WEB_APP_URL = 'http://localhost:3000';
    const service = new MailService();

    await service.sendEmailVerification('user@example.com', 'tok_abc');

    expect(service.lastVerificationTokenFor('user@example.com')).toBe('tok_abc');
  });

  it('clears the outbox', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    const service = new MailService();
    await service.sendEmailVerification('user@example.com', 'tok_abc');
    service.clearOutbox();
    expect(service.outbox()).toHaveLength(0);
  });

  it('отправляет уведомление по email и помечает его типом (ТЗ §3.6)', async () => {
    process.env.MAIL_TRANSPORT = 'console';
    const service = new MailService();

    await service.sendNotification('user@example.com', {
      subject: 'Пульс: Недельный отчёт готов',
      text: 'Ваши финансы и настроение за неделю собраны.',
      kind: 'notification:weekly_report',
      link: '/app',
    });

    const mail = service.outbox().at(-1);
    expect(mail?.to).toBe('user@example.com');
    expect(mail?.subject).toContain('Недельный отчёт');
    expect(mail?.kind).toBe('notification:weekly_report');
  });
});

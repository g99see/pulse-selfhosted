// SPDX-License-Identifier: AGPL-3.0-or-later
// Тесты готовых шаблонов HTML-страницы профиля (ТЗ §3.8): каждый шаблон
// самодостаточен и проходит проверку безопасности — без форм на сторонние
// адреса, без автоперенаправлений, размер меньше 2 МБ.
import { describe, expect, it } from 'vitest';
import {
  HTML_TEMPLATES,
  HTML_TEMPLATE_MAX_BYTES,
  auditHtmlTemplate,
  getHtmlTemplate,
} from '../src/html-templates';
import { checkHtmlPage } from '../src/html-page';

const SANDBOX_DOMAIN = 'usercontent.localhost';

describe('готовые шаблоны (ТЗ §3.8)', () => {
  it('содержит визитку, портфолио, вишлист и «мою цель»', () => {
    expect(HTML_TEMPLATES.map((template) => template.id)).toEqual([
      'business-card',
      'portfolio',
      'wishlist',
      'my-goal',
    ]);
    for (const template of HTML_TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
    }
  });

  it('находит шаблон по идентификатору', () => {
    expect(getHtmlTemplate('wishlist')?.id).toBe('wishlist');
    expect(getHtmlTemplate('nope')).toBeUndefined();
  });

  it('каждый шаблон — самодостаточная HTML-страница с viewport и title', () => {
    for (const template of HTML_TEMPLATES) {
      expect(template.html).toMatch(/^<!DOCTYPE html>/i);
      expect(template.html).toContain('<meta charset="utf-8">');
      expect(template.html).toContain('name="viewport"');
      expect(template.html).toMatch(/<title>[^<]+<\/title>/);
      expect(template.html).toMatch(/<\/html>\s*$/);
    }
  });

  it('каждый шаблон проходит каноническую автопроверку без замечаний', () => {
    for (const template of HTML_TEMPLATES) {
      const result = checkHtmlPage(template.html, { sandboxDomain: SANDBOX_DOMAIN });
      expect(result.status, template.id).toBe('ok');
      expect(result.reasons, template.id).toEqual([]);
    }
  });

  it('каждый шаблон проходит обёртку auditHtmlTemplate', () => {
    for (const template of HTML_TEMPLATES) {
      const report = auditHtmlTemplate(template.html, SANDBOX_DOMAIN);
      expect(report.issues, template.id).toEqual([]);
      expect(report.warnings, template.id).toEqual([]);
      expect(report.ok, template.id).toBe(true);
    }
  });

  it('каждый шаблон меньше 2 МБ (ТЗ §3.8)', () => {
    for (const template of HTML_TEMPLATES) {
      const report = auditHtmlTemplate(template.html);
      expect(report.bytes, template.id).toBeGreaterThan(0);
      expect(report.bytes, template.id).toBeLessThan(HTML_TEMPLATE_MAX_BYTES);
    }
  });

  it('шаблоны не содержат форм, редиректов и внешних скриптов', () => {
    for (const template of HTML_TEMPLATES) {
      expect(template.html, template.id).not.toMatch(/<form\b/i);
      expect(template.html, template.id).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);
      expect(template.html, template.id).not.toMatch(/window\.location\s*=/i);
      expect(template.html, template.id).not.toMatch(/<script\b/i);
    }
  });
});

describe('auditHtmlTemplate', () => {
  it('блокирует форму на сторонний адрес', () => {
    const report = auditHtmlTemplate('<form action="https://evil.example/login"></form>');
    expect(report.ok).toBe(false);
    expect(report.issues).toContain('external_form_action');
  });

  it('блокирует мета-обновление с url и авторедирект из скрипта', () => {
    expect(auditHtmlTemplate('<meta http-equiv="refresh" content="0;url=x">').issues).toContain(
      'meta_refresh',
    );
    expect(
      auditHtmlTemplate('<script>window.location = "https://evil.example"</script>').issues,
    ).toContain('auto_redirect');
  });

  it('внешний скрипт помечается предупреждением, а не блокировкой', () => {
    const report = auditHtmlTemplate('<script src="https://evil.example/x.js"></script>');
    expect(report.issues).not.toContain('external_script');
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it('блокирует пустую страницу и страницу больше 2 МБ', () => {
    expect(auditHtmlTemplate('   ').issues).toContain('empty');
    const big = auditHtmlTemplate('<!-- ' + 'x'.repeat(HTML_TEMPLATE_MAX_BYTES + 1) + ' -->');
    expect(big.ok).toBe(false);
    expect(big.issues).toContain('too_large');
  });

  it('пропускает обычную страницу со ссылками и инлайновыми стилями', () => {
    const report = auditHtmlTemplate(
      '<!DOCTYPE html><html><head><title>ok</title></head><body><a href="https://example.com">x</a></body></html>',
    );
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });
});

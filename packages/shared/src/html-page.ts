// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * HTML-страница в публичном профиле (ТЗ §3.8, §6, §10): контракт API, схемы,
 * DTO и чистая функция автопроверки при сохранении.
 *
 * Страница отдаётся с отдельного домена песочницы (SANDBOX_DOMAIN) в изолированном
 * iframe с sandbox="allow-scripts", без cookie основного сайта, под строгой CSP.
 * Перед публикацией HTML проходит автопроверку: формы с action на сторонние
 * адреса, meta refresh и авторедиректы, формы с паролём на внешние хосты и
 * подозрительные ссылки. Результат — ok | blocked | flagged; blocked не публикуется.
 *
 * Модуль общий для API (принудительная проверка) и web (живой предпросмотр).
 */
import { z } from 'zod';

/** Максимальный размер HTML-страницы: 2 МБ (ТЗ §3.8). */
export const HTML_PAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Сколько последних версий хранится (ТЗ §3.8: последние 10 сохранений с откатом). */
export const HTML_PAGE_VERSION_LIMIT = 10;

/** Итог автопроверки страницы при сохранении (ТЗ §3.8). */
export const HtmlCheckStatusSchema = z.enum(['ok', 'blocked', 'flagged']);
export type HtmlCheckStatus = z.infer<typeof HtmlCheckStatusSchema>;

/** Код причины автопроверки. */
export const HtmlCheckCodes = [
  /** Форма с action на сторонний адрес (ТЗ §3.8). */
  'external_form_action',
  /** <meta http-equiv="refresh" ... url=...> — автоперенаправление. */
  'meta_refresh',
  /** Присваивание location в скрипте — автоперенаправление. */
  'auto_redirect',
  /** Парольный ввод в форме, отправляющей данные на внешний хост (фишинг). */
  'password_form_external',
  /** Ссылка, похожая на фишинговую: внешний адрес плюс «логин/пароль/банк». */
  'suspicious_link',
  /** javascript:-ссылка. */
  'javascript_url',
  /** Внешний <script src="..."> — CSP его всё равно заблокирует. */
  'external_script',
  /** Скрипт обращается к внешнему адресу (fetch / XHR / sendBeacon). */
  'external_request',
  /** Антивирус (ClamAV) нашёл угрозу в файле. */
  'antivirus',
] as const;
export const HtmlCheckCodeSchema = z.enum(HtmlCheckCodes);
export type HtmlCheckCode = (typeof HtmlCheckCodes)[number];

/** Одна причина результата проверки. */
export interface HtmlCheckReason {
  code: HtmlCheckCode;
  /** blocked — публикация запрещена; flagged — сохранено, но помечено. */
  severity: 'blocked' | 'flagged';
  /** Человекочитаемое пояснение (для UI, блок D). */
  message: string;
  /** Фрагмент разметки/адреса, вызвавший замечание. */
  detail?: string;
}

/** Результат автопроверки (ТЗ §3.8). */
export interface HtmlCheckResult {
  status: HtmlCheckStatus;
  reasons: HtmlCheckReason[];
}

/** Опции проверки: домен песочницы, относительно которого определяется «внешний». */
export interface HtmlCheckOptions {
  sandboxDomain: string;
}

/** Сообщения причин на русском (используются и API, и web). */
const REASON_MESSAGES: Record<HtmlCheckCode, string> = {
  external_form_action: 'Форма отправляет данные на сторонний адрес',
  meta_refresh: 'Страница перенаправляет браузер через meta refresh',
  auto_redirect: 'Скрипт перенаправляет браузер (location)',
  password_form_external: 'Пароль отправляется на сторонний адрес',
  suspicious_link: 'Ссылка ведёт на подозрительный адрес (вход, пароль, банк)',
  javascript_url: 'Ссылка javascript: вместо обычного адреса',
  external_script: 'Подключён внешний скрипт — CSP его заблокирует',
  external_request: 'Скрипт обращается к стороннему адресу',
  antivirus: 'Антивирус нашёл угрозу в этом файле',
};

/** Слова, выдающие фишинговую ссылку (логин, пароль, банк и т.п.). */
const PHISHING_WORDS =
  /(log[-\s]?in|sign[-\s]?in|вход|войти|парол|password|passwd|verify|подтверд|account|аккаунт|bank|банк|wallet|кошел|secure|security|безопасн|reset|сброс)/i;

/** Хост домена песочницы без порта и схемы. */
function normalizeHost(domain: string): string {
  const value = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '');
  return (value.split('/')[0] ?? '').split(':')[0] ?? '';
}

/**
 * Абсолютный ли это адрес на сторонний хост. Относительные пути и пустые
 * значения считаются своими (ведут на домен песочницы).
 */
function isExternalAddress(raw: string, sandboxHost: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || value.startsWith('#')) return false;
  if (/^javascript:/i.test(value)) return false;
  if (value.startsWith('//')) {
    return normalizeHost(value.slice(2)) !== sandboxHost;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    if (!/^https?:/i.test(value)) return true;
    try {
      return new URL(value).host.toLowerCase().split(':')[0] !== sandboxHost;
    } catch {
      return true;
    }
  }
  // Относительный путь — свой.
  return false;
}

/** Адрес, начинающийся со схемы javascript:. */
function isJavascriptUrl(value: string): boolean {
  return /^\s*javascript:/i.test(value);
}

/** Значение атрибута: quoted, unquoted или отсутствует. */
function attrValue(tag: string, name: string): string | null {
  const quoted = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (quoted) return quoted[2] ?? quoted[3] ?? '';
  const bare = new RegExp(`${name}\\s*=\\s*([^\\s>]+)`, 'i').exec(tag);
  return bare ? bare[1] : null;
}

/** Обработка содержимого <script>: автоперенаправления и внешние запросы. */
function inspectScript(code: string, sandboxHost: string, reasons: HtmlCheckReason[]): void {
  if (
    /\b(?:window\.|document\.|top\.|self\.)?location\s*(?:\.(?:href|replace|assign|reload))?\s*(?:=|\.replace\s*\(|\.assign\s*\()/i.test(
      code,
    )
  ) {
    reasons.push({
      code: 'auto_redirect',
      severity: 'blocked',
      message: REASON_MESSAGES.auto_redirect,
    });
  }

  const calls = /(?:fetch|XMLHttpRequest|navigator\.sendBeacon)\s*\(\s*(['"`])([^'"`]+)\1/gi;
  let call: RegExpExecArray | null;
  while ((call = calls.exec(code)) !== null) {
    if (isExternalAddress(call[2], sandboxHost)) {
      reasons.push({
        code: 'external_request',
        severity: 'flagged',
        message: REASON_MESSAGES.external_request,
        detail: call[2],
      });
    }
  }
}

/**
 * Чистая автопроверка HTML-страницы (ТЗ §3.8). Не санитайзер и не заменяет CSP:
 * это быстрый запрет на фишинг и автоперенаправления до публикации.
 */
export function checkHtmlPage(html: string, options: HtmlCheckOptions): HtmlCheckResult {
  const sandboxHost = normalizeHost(options.sandboxDomain);
  const reasons: HtmlCheckReason[] = [];

  // Формы: action на сторонний адрес и парольные поля.
  const formRe = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  let form: RegExpExecArray | null;
  while ((form = formRe.exec(html)) !== null) {
    const tag = form[0].slice(0, form[0].indexOf('>') + 1);
    const action = attrValue(tag, 'action') ?? '';
    const external = isExternalAddress(action, sandboxHost) || isJavascriptUrl(action);
    const hasPassword = /<input\b[^>]*\btype\s*=\s*["']?password["']?/i.test(form[1]);

    if (external) {
      reasons.push({
        code: 'external_form_action',
        severity: 'blocked',
        message: REASON_MESSAGES.external_form_action,
        detail: action || '(пусто)',
      });
      if (hasPassword) {
        reasons.push({
          code: 'password_form_external',
          severity: 'blocked',
          message: REASON_MESSAGES.password_form_external,
          detail: action || '(пусто)',
        });
      }
    }
  }

  // meta refresh: любой редирект запрещён, простой перезагруз остаётся flagged.
  const metaRe = /<meta\b[^>]*>/gi;
  let meta: RegExpExecArray | null;
  while ((meta = metaRe.exec(html)) !== null) {
    const tag = meta[0];
    const httpEquiv = attrValue(tag, 'http-equiv');
    if (!httpEquiv || httpEquiv.toLowerCase() !== 'refresh') continue;
    const content = attrValue(tag, 'content') ?? '';
    const hasUrl = /url\s*=/i.test(content) || /;\s*https?:/i.test(content);
    reasons.push({
      code: 'meta_refresh',
      severity: hasUrl ? 'blocked' : 'flagged',
      message: REASON_MESSAGES.meta_refresh,
      detail: content || undefined,
    });
  }

  // Внешние скрипты (CSP с script-src 'unsafe-inline' их не пропустит).
  const scriptSrcRe = /<script\b[^>]*\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let scriptTag: RegExpExecArray | null;
  while ((scriptTag = scriptSrcRe.exec(html)) !== null) {
    const src = scriptTag[2] ?? scriptTag[3] ?? scriptTag[4] ?? '';
    if (isExternalAddress(src, sandboxHost)) {
      reasons.push({
        code: 'external_script',
        severity: 'flagged',
        message: REASON_MESSAGES.external_script,
        detail: src,
      });
    }
  }

  // Тело inline-скриптов.
  const scriptBodyRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptBody: RegExpExecArray | null;
  while ((scriptBody = scriptBodyRe.exec(html)) !== null) {
    inspectScript(scriptBody[1], sandboxHost, reasons);
  }

  // Ссылки: javascript: и фишинговые внешние адреса.
  const linkRe = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
  let link: RegExpExecArray | null;
  while ((link = linkRe.exec(html)) !== null) {
    const href = link[2] ?? link[3] ?? link[4] ?? '';
    const text = link[5].replace(/<[^>]*>/g, ' ');
    if (isJavascriptUrl(href)) {
      reasons.push({
        code: 'javascript_url',
        severity: 'flagged',
        message: REASON_MESSAGES.javascript_url,
        detail: href,
      });
      continue;
    }
    if (isExternalAddress(href, sandboxHost) && PHISHING_WORDS.test(`${href} ${text}`)) {
      reasons.push({
        code: 'suspicious_link',
        severity: 'blocked',
        message: REASON_MESSAGES.suspicious_link,
        detail: href,
      });
    }
  }

  const status: HtmlCheckStatus = reasons.some((reason) => reason.severity === 'blocked')
    ? 'blocked'
    : reasons.length > 0
      ? 'flagged'
      : 'ok';

  return { status, reasons };
}

/** Размер строки в байтах UTF-8 (без зависимости от Buffer — работает и в web). */
export function htmlByteLength(html: string): number {
  return new TextEncoder().encode(html).length;
}

/** HTML-код страницы: непустой, не больше 2 МБ (ТЗ §3.8). */
export const HtmlPageContentSchema = z
  .string()
  .min(1, { message: 'Страница пустая' })
  .refine((value) => htmlByteLength(value) <= HTML_PAGE_MAX_BYTES, {
    message: 'Файл больше 2 МБ',
  });

/** Сохранение страницы: код, необязательная заметка версии и флаг публикации. */
export const HtmlPageSaveSchema = z.object({
  html: HtmlPageContentSchema,
  note: z.string().trim().max(200).optional(),
  published: z.boolean().optional(),
});
export type HtmlPageSaveInput = z.infer<typeof HtmlPageSaveSchema>;
export type HtmlPageSaveValues = z.input<typeof HtmlPageSaveSchema>;

/** Версия страницы в истории (ТЗ §3.8). */
export interface HtmlPageVersionDto {
  id: string;
  note: string | null;
  checkStatus: HtmlCheckStatus;
  checkReasons: HtmlCheckReason[];
  sizeBytes: number;
  createdAt: string;
  html: string;
}

/** Текущее состояние HTML-страницы пользователя. */
export interface HtmlPageDto {
  /** Была ли страница хоть раз сохранена. */
  exists: boolean;
  published: boolean;
  nickname: string;
  /** Публичный адрес страницы на домене песочницы. */
  sandboxUrl: string;
  currentVersionId: string | null;
  checkStatus: HtmlCheckStatus;
  checkReasons: HtmlCheckReason[];
  /** Текущий HTML или null, если страницы ещё нет. */
  html: string | null;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface HtmlPageResponse {
  page: HtmlPageDto;
}

export interface HtmlPageVersionsResponse {
  versions: HtmlPageVersionDto[];
}

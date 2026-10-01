// SPDX-License-Identifier: AGPL-3.0-or-later
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  HTML_PAGE_VERSION_LIMIT,
  checkHtmlPage,
  htmlByteLength,
  type HtmlCheckReason,
  type HtmlCheckResult,
  type HtmlCheckStatus,
  type HtmlPageDto,
  type HtmlPageSaveInput,
  type HtmlPageVersionDto,
} from '@puls/shared';
import { httpError } from '../common/http-error';
import { PrismaService } from '../prisma/prisma.service';
import { CLAMAV_SCANNER, type ClamAvScanner } from './clamav';

type VersionRow = Prisma.HtmlPageVersionGetPayload<object>;

/** Разбирает JSON-причины проверки из БД в типизированный массив. */
function parseReasons(value: Prisma.JsonValue): HtmlCheckReason[] {
  return Array.isArray(value) ? (value as unknown as HtmlCheckReason[]) : [];
}

/**
 * HTML-страница пользователя (ТЗ §3.8): сохранение с автопроверкой, история
 * последних 10 версий с откатом, публичная выдача с отдельного домена.
 * Всё привязано к текущему пользователю; чужие страницы недоступны (404).
 */
@Injectable()
export class HtmlPageService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLAMAV_SCANNER) private readonly clamav: ClamAvScanner,
  ) {}

  /** Домен песочницы, где отдаётся пользовательский HTML (ТЗ §3.8, §10). */
  sandboxDomain(): string {
    return process.env.SANDBOX_DOMAIN?.trim() || 'usercontent.localhost';
  }

  /**
   * Публичный адрес страницы: SANDBOX_ORIGIN (полный origin, например
   * http://192.168.1.50:8080 для установки по http) либо https://SANDBOX_DOMAIN.
   */
  sandboxUrl(nickname: string): string {
    const origin = process.env.SANDBOX_ORIGIN?.trim().replace(/\/+$/, '');
    return `${origin || `https://${this.sandboxDomain()}`}/sandbox/${encodeURIComponent(nickname)}`;
  }

  private toVersionDto(version: VersionRow): HtmlPageVersionDto {
    return {
      id: version.id,
      note: version.note,
      checkStatus: version.checkStatus as HtmlCheckStatus,
      checkReasons: parseReasons(version.checkReasons),
      sizeBytes: htmlByteLength(version.html),
      createdAt: version.createdAt.toISOString(),
      html: version.html,
    };
  }

  private toPageDto(
    nickname: string,
    page: { published: boolean; currentVersionId: string | null; updatedAt: Date } | null,
    version: VersionRow | null,
  ): HtmlPageDto {
    return {
      exists: page !== null,
      published: page?.published ?? false,
      nickname,
      sandboxUrl: this.sandboxUrl(nickname),
      currentVersionId: page?.currentVersionId ?? null,
      checkStatus: (version?.checkStatus as HtmlCheckStatus) ?? 'ok',
      checkReasons: version ? parseReasons(version.checkReasons) : [],
      html: version?.html ?? null,
      sizeBytes: version ? htmlByteLength(version.html) : 0,
      updatedAt: page?.updatedAt.toISOString() ?? null,
    };
  }

  /** Прогоняет автопроверку разметки и антивирус, объединяя результат. */
  private async inspect(html: string): Promise<HtmlCheckResult> {
    const check = checkHtmlPage(html, { sandboxDomain: this.sandboxDomain() });
    const scan = await this.clamav.scan(Buffer.from(html, 'utf8'));
    const reasons = [...check.reasons];
    if (scan.infected) {
      reasons.push({
        code: 'antivirus',
        severity: 'blocked',
        message: 'Антивирус нашёл угрозу в этом файле',
        detail: scan.signature,
      });
    }
    const status: HtmlCheckStatus = reasons.some((reason) => reason.severity === 'blocked')
      ? 'blocked'
      : reasons.length > 0
        ? 'flagged'
        : 'ok';
    return { status, reasons };
  }

  async get(userId: string, nickname: string): Promise<HtmlPageDto> {
    const page = await this.prisma.htmlPage.findUnique({
      where: { userId },
      include: { currentVersion: true },
    });
    return this.toPageDto(nickname, page, page?.currentVersion ?? null);
  }

  async listVersions(userId: string): Promise<HtmlPageVersionDto[]> {
    const page = await this.prisma.htmlPage.findUnique({ where: { userId }, select: { id: true } });
    if (!page) return [];
    const versions = await this.prisma.htmlPageVersion.findMany({
      where: { pageId: page.id },
      orderBy: { createdAt: 'desc' },
      take: HTML_PAGE_VERSION_LIMIT,
    });
    return versions.map((version) => this.toVersionDto(version));
  }

  /**
   * Сохраняет новую версию страницы. blocked-версию опубликовать нельзя:
   * флаг публикации принудительно сбрасывается. Хранятся последние 10 версий.
   */
  async save(userId: string, nickname: string, input: HtmlPageSaveInput): Promise<HtmlPageDto> {
    const check = await this.inspect(input.html);

    const { page, version } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.htmlPage.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      const created = await tx.htmlPageVersion.create({
        data: {
          pageId: existing.id,
          userId,
          html: input.html,
          note: input.note ?? null,
          checkStatus: check.status,
          checkReasons: check.reasons as unknown as Prisma.InputJsonValue,
        },
      });

      const requestedPublished = input.published ?? existing.published;
      const published = check.status === 'blocked' ? false : requestedPublished;

      const updated = await tx.htmlPage.update({
        where: { id: existing.id },
        data: { currentVersionId: created.id, published },
      });

      await this.prune(tx, existing.id);
      return { page: updated, version: created };
    });

    return this.toPageDto(nickname, page, version);
  }

  /** Загрузка одного файла .html (до 2 МБ): расширение/тип проверяются тут. */
  async upload(
    userId: string,
    nickname: string,
    file: { originalname: string; mimetype: string; buffer: Buffer },
  ): Promise<HtmlPageDto> {
    const name = file.originalname.toLowerCase();
    const isHtml = name.endsWith('.html') || name.endsWith('.htm') || name.endsWith('.xhtml');
    if (!isHtml) {
      throw httpError(400, 'invalid_file_type', 'Загрузите файл с расширением .html');
    }
    return this.save(userId, nickname, {
      html: file.buffer.toString('utf8'),
      note: file.originalname,
    });
  }

  /** Откат: создаёт новую версию из выбранной, не удаляя историю (ТЗ §3.8). */
  async restore(userId: string, nickname: string, versionId: string): Promise<HtmlPageDto> {
    const source = await this.prisma.htmlPageVersion.findFirst({
      where: { id: versionId, userId },
    });
    if (!source) {
      throw httpError(404, 'version_not_found', 'Версия не найдена');
    }
    const note = `Откат к версии от ${source.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`;
    const check = await this.inspect(source.html);

    const { page, version } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.htmlPage.findUniqueOrThrow({ where: { userId } });
      const created = await tx.htmlPageVersion.create({
        data: {
          pageId: existing.id,
          userId,
          html: source.html,
          note,
          checkStatus: check.status,
          checkReasons: check.reasons as unknown as Prisma.InputJsonValue,
        },
      });
      const published = check.status === 'blocked' ? false : existing.published;
      const updated = await tx.htmlPage.update({
        where: { id: existing.id },
        data: { currentVersionId: created.id, published },
      });
      await this.prune(tx, existing.id);
      return { page: updated, version: created };
    });

    return this.toPageDto(nickname, page, version);
  }

  /** Удаляет страницу и всю её историю (каскадом). */
  async remove(userId: string): Promise<void> {
    await this.prisma.htmlPage.deleteMany({ where: { userId } });
  }

  /** Оставляет последние HTML_PAGE_VERSION_LIMIT версий, старые удаляет. */
  private async prune(tx: Prisma.TransactionClient, pageId: string): Promise<void> {
    const stale = await tx.htmlPageVersion.findMany({
      where: { pageId },
      orderBy: { createdAt: 'desc' },
      skip: HTML_PAGE_VERSION_LIMIT,
      select: { id: true },
    });
    if (stale.length > 0) {
      await tx.htmlPageVersion.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    }
  }

  /**
   * Публичная страница для домена песочницы. Отдаётся, только если страница
   * опубликована, текущая версия не blocked, карточка html_page видна публично
   * (или карточки нет — тогда решает флаг published) и контент не скрыт
   * модератором (ContentFlag).
   */
  async resolvePublished(nickname: string): Promise<{ html: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { nickname },
      include: {
        htmlPage: { include: { currentVersion: true } },
        profileCards: { where: { type: 'html_page' } },
      },
    });
    const page = user?.htmlPage;
    if (!user || !page || !page.published || !page.currentVersion) return null;
    if (page.currentVersion.checkStatus === 'blocked') return null;

    const card = user.profileCards[0];
    if (card && card.visibility !== 'public') return null;

    const flag = await this.prisma.contentFlag.findUnique({
      where: { targetType_targetId: { targetType: 'html_page', targetId: page.id } },
    });
    if (flag?.hidden) return null;

    return { html: page.currentVersion.html };
  }
}

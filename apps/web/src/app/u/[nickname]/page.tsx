// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Публичный профиль (ТЗ §3.7): страница `/@nickname` с аватаром, обложкой,
 * описанием и карточками. Символ `@` зарезервирован Next за parallel routes,
 * поэтому короткий адрес отдаётся rewrite'ом на `/u/:nickname`
 * (см. next.config.mjs). Приватность карточек решает API: private здесь
 * никогда не появляется, subscribers — только для подписчика.
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NICKNAME_REGEX, type ProfileCardDto, type PublicProfileResponse } from '@puls/shared';
import { SERVER_API_URL } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { t } from '@/lib/i18n';
import { getRequestLocale } from '@/lib/locale-server';

export const dynamic = 'force-dynamic';

async function fetchProfile(nickname: string): Promise<PublicProfileResponse['profile'] | null> {
  const response = await fetch(
    `${SERVER_API_URL.replace(/\/+$/, '')}/api/public/profiles/${encodeURIComponent(nickname)}`,
    { cache: 'no-store' },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`profile_request_failed:${response.status}`);
  const body = (await response.json()) as PublicProfileResponse;
  return body.profile;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ nickname: string }>;
}): Promise<Metadata> {
  const { nickname } = await params;
  return { title: `@${nickname.replace(/^@/, '')}` };
}

function CardBody({
  card,
  locale,
  profileNickname,
}: {
  card: ProfileCardDto;
  locale: Awaited<ReturnType<typeof getRequestLocale>>;
  profileNickname: string;
}) {
  switch (card.data.kind) {
    case 'savings':
      return (
        <p className="text-2xl font-bold">
          {t('profile.public.percent', locale, { percent: card.data.percent })}
          {card.data.amount !== null
            ? ` · ${formatNumber(card.data.amount, locale)} ${card.data.currency}`
            : null}
        </p>
      );
    case 'checkin_streak':
      return (
        <div className="flex flex-col gap-1">
          <p className="text-xl font-bold">
            {t('profile.public.streak.current', locale, { days: card.data.current })}
          </p>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {t('profile.public.streak.longest', locale, { days: card.data.longest })}
          </p>
        </div>
      );
    case 'avg_mood':
      return (
        <p className="text-xl font-bold">
          {card.data.average === null
            ? t('profile.public.mood.empty', locale)
            : t('profile.public.mood.value', locale, {
                mood: formatNumber(card.data.average, locale, { maximumFractionDigits: 1 }),
              })}
        </p>
      );
    case 'achievements':
      return (
        <p className="text-xl font-bold">
          {t('profile.public.achievements.value', locale, {
            earned: card.data.earned,
            total: card.data.total,
          })}
        </p>
      );
    case 'goals':
      return card.data.goals.length === 0 ? (
        <p className="text-sm text-[var(--puls-ink-muted)]">
          {t('profile.public.goals.empty', locale)}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {card.data.goals.map((goal) => (
            <li key={goal.id} className="flex items-center justify-between gap-3">
              <span className="font-medium">{goal.title}</span>
              <span className="font-bold">
                {t('profile.public.percent', locale, { percent: goal.percent })}
                {goal.amount !== null ? ` · ${formatNumber(goal.amount, locale)}` : null}
              </span>
            </li>
          ))}
        </ul>
      );
    case 'html_page':
      return (
        <div className="flex flex-col gap-2">
          <div
            className="prose max-w-none text-sm"
            // HTML очищен на стороне API (sanitizeCardHtml, ТЗ §3.8).
            dangerouslySetInnerHTML={{ __html: card.data.html }}
          />
          {/* Отдельная вкладка страницы: /@nickname/page (ТЗ §3.8). */}
          <a
            href={`/@${profileNickname}/page`}
            data-testid="public-html-tab-link"
            className="text-sm text-[var(--puls-primary-text)] underline"
          >
            {t('htmlPage.viewer.open', locale)}
          </a>
        </div>
      );
    default:
      return null;
  }
}

/** Тип карточки → ключ заголовка в i18n (имена типов и ключей различаются). */
const CARD_TITLE_KEY: Record<ProfileCardDto['data']['kind'], string> = {
  savings: 'profile.public.card.savings',
  checkin_streak: 'profile.public.card.streak',
  avg_mood: 'profile.public.card.mood',
  achievements: 'profile.public.card.achievements',
  goals: 'profile.public.card.goals',
  html_page: 'profile.public.card.html',
};

function cardTitle(
  card: ProfileCardDto,
  locale: Awaited<ReturnType<typeof getRequestLocale>>,
): string {
  if (card.title) return card.title;
  return t(CARD_TITLE_KEY[card.data.kind], locale);
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ nickname: string }>;
}) {
  const locale = await getRequestLocale();
  const { nickname } = await params;
  const handle = nickname.replace(/^@/, '').toLowerCase();
  if (!NICKNAME_REGEX.test(handle)) notFound();

  const profile = await fetchProfile(handle);
  if (!profile) notFound();

  return (
    <main
      className="puls-backdrop mx-auto min-h-screen w-full max-w-3xl px-5 py-8"
      data-testid="public-profile"
    >
      <div className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-[var(--radius-card)] bg-[var(--puls-surface)] shadow-sm">
          {profile.coverUrl ? (
            <img src={profile.coverUrl} alt="" className="h-40 w-full object-cover" />
          ) : (
            <div
              aria-hidden="true"
              className="h-40 w-full bg-gradient-to-br from-[var(--puls-primary-soft)] via-[var(--puls-wellbeing-soft)] to-[var(--puls-finance-soft)]"
            />
          )}
          <div className="-mt-10 flex items-end gap-4 px-5 pb-5">
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt=""
                className="h-20 w-20 rounded-full border-4 border-[var(--puls-surface)] object-cover"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-[var(--puls-surface)] bg-[var(--puls-primary-soft)] font-heading text-2xl font-extrabold text-[var(--puls-primary-text)]"
              >
                {profile.nickname.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="flex flex-col pb-1">
              <h1 className="text-2xl font-extrabold">@{profile.nickname}</h1>
              {profile.bio ? (
                <p className="text-sm text-[var(--puls-ink-muted)]">{profile.bio}</p>
              ) : null}
            </div>
          </div>
        </div>

        {profile.cards.length === 0 ? (
          <p className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6 text-center text-[var(--puls-ink-muted)] shadow-sm">
            {t('profile.public.empty', locale)}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {profile.cards.map((card) => (
              <section
                key={card.type}
                data-testid={`public-card-${card.type}`}
                className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm"
              >
                <h2 className="font-heading text-sm font-bold text-[var(--puls-ink-muted)]">
                  {cardTitle(card, locale)}
                </h2>
                <CardBody card={card} locale={locale} profileNickname={profile.nickname} />
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useEffect, useState } from 'react';
import {
  BIO_MAX,
  cardTypeSupportsAmount,
  type OwnProfileDto,
  type ProfileCardInput,
  type ProfileCardType,
  type ProfileVisibility,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, Card, Field, PrimaryButton, Select } from '@/components/ui';
import { profileApi } from '@/lib/profile-client';

const VISIBILITIES: ProfileVisibility[] = ['public', 'subscribers', 'private'];
const MASKED = '•••';

/** Типы карточек, которые всегда показываем в редакторе. */
const ALL_TYPES: ProfileCardType[] = [
  'savings',
  'checkin_streak',
  'avg_mood',
  'achievements',
  'goals',
  'html_page',
];

function toInputCards(profile: OwnProfileDto): ProfileCardInput[] {
  const byType = new Map(profile.cards.map((card) => [card.type, card]));
  return ALL_TYPES.map((type) => {
    const card = byType.get(type);
    return {
      type,
      visibility: card?.visibility ?? 'private',
      mode: card?.mode ?? 'percent',
      title: card?.title ?? undefined,
      html: undefined,
    };
  });
}

/** Редактор публичного профиля (ТЗ §3.7): описание, картинки и карточки. */
export function ProfileEditor() {
  const { t } = useT();
  const [profile, setProfile] = useState<OwnProfileDto | null>(null);
  const [bio, setBio] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [coverUrl, setCoverUrl] = useState('');
  const [cards, setCards] = useState<ProfileCardInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    profileApi
      .get()
      .then((response) => {
        if (!active) return;
        const next = response.profile;
        setProfile(next);
        setBio(next.bio ?? '');
        setAvatarUrl(next.avatarUrl ?? '');
        setCoverUrl(next.coverUrl ?? '');
        setCards(toInputCards(next));
      })
      .catch(() => {
        if (active) setError(t('profile.error.load'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Профиль читаем один раз при монтировании.
  }, []);

  function updateCard(index: number, patch: Partial<ProfileCardInput>): void {
    setCards((current) => current.map((card, i) => (i === index ? { ...card, ...patch } : card)));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await profileApi.update({
        bio: bio.trim() === '' ? null : bio.trim(),
        avatarUrl: avatarUrl.trim() === '' ? null : avatarUrl.trim(),
        coverUrl: coverUrl.trim() === '' ? null : coverUrl.trim(),
        cards,
      });
      setProfile(response.profile);
      setSaved(true);
    } catch {
      setError(t('profile.error.save'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <Card className="min-h-48">{t('common.loading')}</Card>;
  }

  return (
    <Card className="flex flex-col gap-5" >
      <div className="-m-5 mb-0 flex items-center gap-4 rounded-t-[var(--radius-card)] bg-gradient-to-br from-[var(--puls-primary-soft)] via-[var(--puls-wellbeing-soft)] to-[var(--puls-finance-soft)] p-5 sm:-m-6 sm:mb-0 sm:p-6">
        <span
          aria-hidden="true"
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-[var(--puls-surface)] bg-[var(--puls-surface)] font-heading text-xl font-extrabold text-[var(--puls-primary-text)]"
        >
          {profile ? profile.nickname.slice(0, 2).toUpperCase() : '··'}
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="font-heading text-lg font-bold text-[var(--puls-ink)]">{t('profile.title')}</h2>
          <p className="text-sm text-[var(--puls-ink)]">
            {t('profile.subtitle', { nickname: profile?.nickname ?? MASKED })}
          </p>
        </div>
      </div>

      <Field
        id="profile-bio"
        label={t('profile.bio')}
        hint={t('profile.bioHint', { max: BIO_MAX })}
        value={bio}
        maxLength={BIO_MAX}
        onChange={(event) => setBio(event.target.value)}
      />
      <Field
        id="profile-avatar"
        label={t('profile.avatarUrl')}
        hint={t('profile.imageHint')}
        value={avatarUrl}
        onChange={(event) => setAvatarUrl(event.target.value)}
      />
      <Field
        id="profile-cover"
        label={t('profile.coverUrl')}
        hint={t('profile.imageHint')}
        value={coverUrl}
        onChange={(event) => setCoverUrl(event.target.value)}
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="font-heading font-bold">{t('profile.cards')}</h3>
          <p className="text-xs text-[var(--puls-ink-muted)]">{t('profile.cardsHint')}</p>
        </div>

        {cards.map((card, index) => (
          <div
            key={card.type}
            data-testid={`profile-card-${card.type}`}
            className="flex flex-col gap-3 rounded-[20px] bg-[var(--puls-surface-2)] p-4"
          >
            <p className="font-medium">{t(`profile.card.${card.type}`)}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                id={`profile-visibility-${card.type}`}
                label={t('profile.visibility')}
                value={card.visibility}
                onChange={(event) =>
                  updateCard(index, { visibility: event.target.value as ProfileVisibility })
                }
              >
                {VISIBILITIES.map((visibility) => (
                  <option key={visibility} value={visibility}>
                    {t(`profile.visibility.${visibility}`)}
                  </option>
                ))}
              </Select>

              {cardTypeSupportsAmount(card.type) ? (
                <Select
                  id={`profile-mode-${card.type}`}
                  label={t('profile.mode')}
                  value={card.mode}
                  onChange={(event) =>
                    updateCard(index, { mode: event.target.value as 'percent' | 'amount' })
                  }
                >
                  <option value="percent">{t('profile.mode.percent')}</option>
                  <option value="amount">{t('profile.mode.amount')}</option>
                </Select>
              ) : null}
            </div>
            <Field
              id={`profile-title-${card.type}`}
              label={t('profile.cardTitle')}
              value={card.title ?? ''}
              onChange={(event) => updateCard(index, { title: event.target.value })}
            />
            {card.type === 'html_page' ? (
              <textarea
                id="profile-html"
                aria-label={t('profile.card.html_page')}
                value={card.html ?? ''}
                onChange={(event) => updateCard(index, { html: event.target.value })}
                className="min-h-32 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] p-4 font-mono text-sm outline-none focus:border-[var(--puls-primary)]"
              />
            ) : null}
          </div>
        ))}
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {saved ? <Alert tone="success">{t('profile.saved')}</Alert> : null}

      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton type="button" onClick={save} disabled={saving} data-testid="profile-save">
          {t('profile.save')}
        </PrimaryButton>
        {profile ? (
          <a
            href={`/@${profile.nickname}`}
            data-testid="profile-open-public"
            className="text-sm font-medium text-[var(--puls-primary-text)] underline"
          >
            {t('profile.openPublic')}
          </a>
        ) : null}
      </div>
    </Card>
  );
}

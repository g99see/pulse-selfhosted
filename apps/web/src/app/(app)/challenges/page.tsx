// SPDX-License-Identifier: AGPL-3.0-or-later
'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CHALLENGE_DURATION_MAX,
  CHALLENGE_KINDS,
  CHALLENGE_TEMPLATES,
  CHALLENGE_VISIBILITIES,
  type ChallengeDto,
  type ChallengeKind,
  type ChallengeLeaderboardDto,
  type ChallengeVisibility,
} from '@puls/shared';
import { useT } from '@/components/locale-provider';
import { Alert, EmptyState, IconBubble } from '@/components/ui';
import { challengesApi } from '@/lib/challenges-client';
import { formatDate } from '@/lib/format';

function templateTitleKey(key: string): string {
  return `challenges.template.${key}`;
}

/** Экран «Челленджи» (ТЗ §4, P2): шаблоны, вступление по коду, рейтинг. */
export default function ChallengesPage() {
  const { t, locale } = useT();

  const [challenges, setChallenges] = useState<ChallengeDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ChallengeKind>('custom');
  const [duration, setDuration] = useState('30');
  const [visibility, setVisibility] = useState<ChallengeVisibility>('private');
  const [joinCode, setJoinCode] = useState('');
  const [boards, setBoards] = useState<Record<string, ChallengeLeaderboardDto>>({});
  const [candidates, setCandidates] = useState<
    Record<string, { userId: string; nickname: string }[]>
  >({});

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await challengesApi.list();
      setChallenges(response.challenges);
      setError(null);
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function applyTemplate(key: string): void {
    const template = CHALLENGE_TEMPLATES.find((item) => item.key === key);
    if (!template) return;
    setTitle(t(templateTitleKey(template.key)));
    setKind(template.kind);
    setDuration(String(template.durationDays));
  }

  async function createChallenge(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const durationDays = Number(duration);
    if (!title.trim()) {
      setError(t('challenges.error.titleRequired'));
      return;
    }
    if (
      !Number.isInteger(durationDays) ||
      durationDays < 1 ||
      durationDays > CHALLENGE_DURATION_MAX
    ) {
      setError(t('challenges.error.duration'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await challengesApi.create({ title: title.trim(), kind, durationDays, visibility });
      setTitle('');
      setNotice(t('challenges.created'));
      await reload();
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function joinChallenge(): Promise<void> {
    if (joinCode.trim().length < 4) {
      setError(t('challenges.error.code'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await challengesApi.join(joinCode.trim());
      setJoinCode('');
      setNotice(t('challenges.joined'));
      await reload();
    } catch {
      setError(t('challenges.error.inviteNotFound'));
    } finally {
      setBusy(false);
    }
  }

  async function check(challenge: ChallengeDto, ok: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await challengesApi.check(challenge.id, ok);
      setNotice(ok ? t('challenges.check.done') : t('challenges.check.failed'));
      await reload();
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function loadLeaderboard(challenge: ChallengeDto): Promise<void> {
    setBusy(true);
    try {
      const board = await challengesApi.leaderboard(challenge.id);
      setBoards((current) => ({ ...current, [challenge.id]: board }));
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function loadCandidates(challenge: ChallengeDto): Promise<void> {
    setBusy(true);
    try {
      const response = await challengesApi.inviteCandidates(challenge.id);
      setCandidates((current) => ({ ...current, [challenge.id]: response.users }));
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function invite(challenge: ChallengeDto, nickname: string): Promise<void> {
    setBusy(true);
    try {
      await challengesApi.invite(challenge.id, nickname);
      setNotice(t('challenges.invited'));
      setCandidates((current) => ({
        ...current,
        [challenge.id]: (current[challenge.id] ?? []).filter((user) => user.nickname !== nickname),
      }));
      await reload();
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function removeChallenge(challenge: ChallengeDto): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(t('challenges.deleteConfirm', { title: challenge.title }))
    ) {
      return;
    }
    setBusy(true);
    try {
      await challengesApi.remove(challenge.id);
      setNotice(t('challenges.deleted'));
      await reload();
    } catch {
      setError(t('challenges.error.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setNotice(t('challenges.codeCopied'));
    } catch {
      setError(t('challenges.error.generic'));
    }
  }

  return (
    <div className="flex flex-col gap-5" data-testid="challenges-page">
      <div className="flex items-center gap-3">
        <IconBubble name="flag" tone="wellbeing" size={48} />
        <h1 className="text-3xl font-extrabold">{t('challenges.title')}</h1>
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <section className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <h2 className="font-heading text-lg font-bold">{t('challenges.add')}</h2>
        <div className="flex flex-wrap gap-2">
          {CHALLENGE_TEMPLATES.map((template) => (
            <button
              key={template.key}
              type="button"
              data-testid={`challenge-template-${template.key}`}
              onClick={() => applyTemplate(template.key)}
              className="rounded-[var(--radius-chip)] bg-[var(--puls-wellbeing-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--puls-wellbeing-text)] hover:opacity-90"
            >
              {t(templateTitleKey(template.key))}
            </button>
          ))}
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => void createChallenge(event)}
        >
          <label htmlFor="challenge-title" className="flex flex-1 flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('challenges.form.title')}
            </span>
            <input
              id="challenge-title"
              data-testid="challenge-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <label htmlFor="challenge-kind" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('challenges.form.kind')}
            </span>
            <select
              id="challenge-kind"
              data-testid="challenge-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as ChallengeKind)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              {CHALLENGE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {t(`challenges.kind.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor="challenge-duration" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('challenges.form.duration')}
            </span>
            <input
              id="challenge-duration"
              data-testid="challenge-duration"
              inputMode="numeric"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              className="h-10 w-24 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            />
          </label>
          <label htmlFor="challenge-visibility" className="flex flex-col gap-1">
            <span className="text-xs text-[var(--puls-ink-muted)]">
              {t('challenges.form.visibility')}
            </span>
            <select
              id="challenge-visibility"
              data-testid="challenge-visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as ChallengeVisibility)}
              className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
            >
              {CHALLENGE_VISIBILITIES.map((option) => (
                <option key={option} value={option}>
                  {t(`challenges.visibility.${option}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            data-testid="challenge-create"
            disabled={busy}
            className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
          >
            {t('challenges.form.submit')}
          </button>
        </form>
      </section>

      <section className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
        <label htmlFor="challenge-join-code" className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-[var(--puls-ink-muted)]">{t('challenges.join.hint')}</span>
          <input
            id="challenge-join-code"
            data-testid="challenge-join-code"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="CH-…"
            className="h-10 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] bg-[var(--puls-surface-2)] px-3"
          />
        </label>
        <button
          type="button"
          data-testid="challenge-join"
          disabled={busy}
          onClick={() => void joinChallenge()}
          className="h-10 rounded-[var(--radius-button)] bg-[var(--puls-finance-soft)] px-4 text-sm font-semibold text-[var(--puls-finance-text)] disabled:opacity-50"
        >
          {t('challenges.join.submit')}
        </button>
      </section>

      <section className="grid gap-4 md:grid-cols-2" data-testid="challenges-list">
        {challenges.map((challenge) => (
          <article
            key={challenge.id}
            data-testid="challenge-card"
            className="flex flex-col gap-3 rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <span
                  className="truncate font-heading text-lg font-bold"
                  data-testid="challenge-card-title"
                >
                  {challenge.title}
                </span>
                <span className="text-sm text-[var(--puls-ink-muted)]">
                  {t(`challenges.kind.${challenge.kind}`)} · {challenge.durationDays}{' '}
                  {t('challenges.days')} · {t(`challenges.visibility.${challenge.visibility}`)}
                </span>
                <span className="text-sm text-[var(--puls-ink-muted)]">
                  {formatDate(challenge.startDate, locale, { dateStyle: 'medium' })} –{' '}
                  {formatDate(challenge.endDate, locale, { dateStyle: 'medium' })}
                </span>
              </div>
              {challenge.isOwner ? (
                <button
                  type="button"
                  data-testid="challenge-delete"
                  onClick={() => void removeChallenge(challenge)}
                  className="text-xs text-[var(--puls-ink-muted)]"
                >
                  {t('challenges.delete')}
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span
                data-testid="challenge-progress"
                className="rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-3 py-1 font-semibold text-[var(--puls-primary-text)]"
              >
                {t('challenges.progress', { percent: challenge.percent })}
              </span>
              <span className="text-[var(--puls-ink-muted)]">
                {t('challenges.held', { days: challenge.heldDays })}
              </span>
              <span className="text-[var(--puls-ink-muted)]">
                {t('challenges.streak', { days: challenge.currentStreak })}
              </span>
              <span className="text-[var(--puls-ink-muted)]">
                {t('challenges.participants', { count: challenge.participantsCount })}
              </span>
            </div>

            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--puls-line)]">
              <div
                className="h-full rounded-full bg-[var(--puls-wellbeing)]"
                style={{ width: `${challenge.percent}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="challenge-check"
                disabled={busy || challenge.checkedToday}
                onClick={() => void check(challenge, true)}
                className="h-9 rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-4 text-sm font-semibold text-[var(--puls-on-primary)] disabled:opacity-50"
              >
                {t('challenges.check.hold')}
              </button>
              <button
                type="button"
                data-testid="challenge-check-fail"
                disabled={busy}
                onClick={() => void check(challenge, false)}
                className="h-9 rounded-[var(--radius-button)] border border-[var(--puls-line-strong)] px-4 text-sm font-medium disabled:opacity-50"
              >
                {t('challenges.check.fail')}
              </button>
              <span className="flex items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--puls-surface-2)] px-3 py-1 text-xs">
                <span className="text-[var(--puls-ink-muted)]">{t('challenges.inviteCode')}</span>
                <span data-testid="challenge-invite-code" className="font-mono">
                  {challenge.inviteCode}
                </span>
                <button
                  type="button"
                  data-testid="challenge-copy"
                  onClick={() => void copyCode(challenge.inviteCode)}
                  className="font-medium text-[var(--puls-primary-text)]"
                >
                  {t('challenges.copy')}
                </button>
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="challenge-leaderboard-open"
                onClick={() => void loadLeaderboard(challenge)}
                className="h-9 rounded-[var(--radius-button)] bg-[var(--puls-surface-2)] px-4 text-sm font-medium hover:bg-[var(--puls-primary-soft)]"
              >
                {t('challenges.leaderboard.open')}
              </button>
              {challenge.isOwner ? (
                <button
                  type="button"
                  data-testid="challenge-invite-open"
                  onClick={() => void loadCandidates(challenge)}
                  className="h-9 rounded-[var(--radius-button)] bg-[var(--puls-surface-2)] px-4 text-sm font-medium hover:bg-[var(--puls-primary-soft)]"
                >
                  {t('challenges.invite.open')}
                </button>
              ) : null}
            </div>

            {boards[challenge.id] ? (
              <ul
                className="flex flex-col gap-1 rounded-[20px] bg-[var(--puls-surface-2)] p-3"
                data-testid="challenge-leaderboard"
              >
                <li className="text-xs font-semibold uppercase text-[var(--puls-ink-muted)]">
                  {t('challenges.leaderboard.title')}
                </li>
                {boards[challenge.id]!.entries.map((entry) => (
                  <li
                    key={entry.userId}
                    data-testid="challenge-leaderboard-entry"
                    className="flex items-center justify-between rounded-[var(--radius-button)] px-2 py-1.5 text-sm odd:bg-[var(--puls-surface)]"
                  >
                    <span>
                      {t('challenges.leaderboard.place', { rank: entry.rank })} @{entry.nickname}
                    </span>
                    <span className="text-[var(--puls-ink-muted)]">
                      {t('challenges.leaderboard.score', { score: entry.score })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {candidates[challenge.id] ? (
              <div className="flex flex-wrap gap-2" data-testid="challenge-invite-candidates">
                {candidates[challenge.id]!.length === 0 ? (
                  <span className="text-xs text-[var(--puls-ink-muted)]">
                    {t('challenges.invite.empty')}
                  </span>
                ) : (
                  candidates[challenge.id]!.map((user) => (
                    <button
                      key={user.userId}
                      type="button"
                      data-testid="challenge-invite"
                      onClick={() => void invite(challenge, user.nickname)}
                      className="rounded-[var(--radius-chip)] bg-[var(--puls-primary-soft)] px-3 py-1 text-xs font-semibold text-[var(--puls-primary-text)]"
                    >
                      {t('challenges.invite.add', { nickname: user.nickname })}
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </article>
        ))}

        {challenges.length === 0 && !loading ? (
          <div
            className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] shadow-sm md:col-span-2"
            data-testid="challenges-empty"
          >
            <EmptyState icon="flag" tone="wellbeing" title={t('challenges.empty')} />
          </div>
        ) : null}
      </section>
    </div>
  );
}

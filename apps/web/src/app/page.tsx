// SPDX-License-Identifier: AGPL-3.0-or-later
import { formatMoney, moodAverage } from '@puls/shared';
import { budgetLevel } from '@/lib/budget';
import { API_BASE_URL, healthUrl } from '@/lib/api';

const DEMO = {
  spent: 41_500,
  budget: 50_000,
  incomes: [3, 4, 4, 5, 2, 3, 4],
  savingsGoal: 120_000,
  savingsSaved: 60_000,
};

export default function LandingPage() {
  const budget = budgetLevel(DEMO.budget, DEMO.spent);
  const mood = moodAverage(DEMO.incomes);
  const goalPercent = Math.round((DEMO.savingsSaved / DEMO.savingsGoal) * 100);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-4">
        <p className="text-sm font-semibold tracking-wide text-[var(--puls-primary)] uppercase">
          self-hosted · AGPL-3.0
        </p>
        <h1 className="text-4xl font-extrabold sm:text-5xl">
          Пульс — деньги и самочувствие в одной ленте
        </h1>
        <p className="max-w-2xl text-lg text-[var(--puls-ink-muted)]">
          Отмечайте состояние за 5 секунд, вносите траты и замечайте, что влияет на настроение и
          энергию. Все данные остаются на вашем сервере.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="#start"
            className="rounded-[var(--radius-button)] bg-[var(--puls-primary)] px-6 py-3 font-semibold text-white"
          >
            Начать
          </a>
          <a
            href="https://github.com/"
            className="rounded-[var(--radius-button)] border border-[var(--puls-ink-muted)]/30 px-6 py-3 font-semibold"
          >
            Исходный код
          </a>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <h2 className="text-sm text-[var(--puls-ink-muted)]">Бюджет месяца</h2>
          <p className="mt-2 text-2xl font-bold">{formatMoney(DEMO.spent)}</p>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {budget.percent}% из {formatMoney(DEMO.budget)}
          </p>
        </article>

        <article className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <h2 className="text-sm text-[var(--puls-ink-muted)]">Настроение за неделю</h2>
          <p className="mt-2 text-2xl font-bold text-[var(--puls-wellbeing)]">{mood ?? '—'} / 5</p>
          <p className="text-sm text-[var(--puls-ink-muted)]">{DEMO.incomes.length} чек-инов</p>
        </article>

        <article className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-5 shadow-sm">
          <h2 className="text-sm text-[var(--puls-ink-muted)]">Цель «Ноутбук»</h2>
          <p className="mt-2 text-2xl font-bold text-[var(--puls-finance)]">{goalPercent}%</p>
          <p className="text-sm text-[var(--puls-ink-muted)]">
            {formatMoney(DEMO.savingsSaved)} из {formatMoney(DEMO.savingsGoal)}
          </p>
        </article>
      </section>

      <section id="start" className="rounded-[var(--radius-card)] bg-[var(--puls-surface)] p-6">
        <h2 className="text-xl font-bold">Фаза 0 пройдена</h2>
        <p className="mt-2 text-[var(--puls-ink-muted)]">
          Монорепо, API и web собраны. Живой статус API:{' '}
          <code className="rounded bg-black/5 px-2 py-1 text-sm">{healthUrl()}</code>
        </p>
        <p className="mt-2 text-sm text-[var(--puls-ink-muted)]">
          База API: {API_BASE_URL}. Следующий шаг — регистрация, онбординг и финансы (Фаза 1).
        </p>
      </section>

      <footer className="text-sm text-[var(--puls-ink-muted)]">
        © {new Date().getFullYear()} Пульс. Лицензия AGPL-3.0-or-later.
      </footer>
    </main>
  );
}

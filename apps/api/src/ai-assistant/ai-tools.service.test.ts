// SPDX-License-Identifier: AGPL-3.0-or-later
// Юнит-тесты инструментов AI-помощника (ТЗ §3.9): изоляция пользователей.
// Проверяем, что инструмент всегда работает от имени сессионного пользователя
// и никогда не выбирает пользователя по аргументам модели; предложения
// записываются за тем же пользователем.
import { describe, expect, it, vi } from 'vitest';
import type { AiContextService } from './ai-context.service';
import type { AiProposalsService } from './ai-proposals.service';
import { AI_TOOL_NAMES, AiToolsService } from './ai-tools.service';

function makeStubs() {
  const seen: string[] = [];
  const context = {
    spendingSummary: vi.fn(async (userId: string) => {
      seen.push(userId);
      return { from: 'a', to: 'b', userId, total: 0, byCategory: [] };
    }),
    listTransactions: vi.fn(async (userId: string, options: { limit?: number }) => {
      seen.push(userId);
      return [{ date: '2026-10-01', type: 'expense', amount: 1, categoryName: 'Еда', limit: options.limit }];
    }),
    moodSeries: vi.fn(async (userId: string) => {
      seen.push(userId);
      return { days: [], avgMood: null, avgEnergy: null, userId };
    }),
    goals: vi.fn(async (userId: string) => {
      seen.push(userId);
      return [];
    }),
    budgets: vi.fn(async (userId: string) => {
      seen.push(userId);
      return [];
    }),
    achievements: vi.fn(async (userId: string) => {
      seen.push(userId);
      return { streak: { current: 0, longest: 0, checkedToday: false }, earned: [], userId };
    }),
    streak: vi.fn(async (userId: string) => {
      seen.push(userId);
      return { current: 0, longest: 0, checkedToday: false };
    }),
    timezoneOf: vi.fn(async () => 'Europe/Moscow'),
  } as unknown as AiContextService;

  const created: { userId: string; kind: string; summary: string; payload: Record<string, unknown> }[] = [];
  const proposals = {
    create: vi.fn(async (input: { userId: string; kind: string; summary: string; payload: Record<string, unknown> }) => {
      created.push(input);
      return { id: `p-${created.length}`, kind: input.kind, summary: input.summary, payload: input.payload, status: 'pending' };
    }),
  } as unknown as AiProposalsService;

  return { context, proposals, seen, created };
}

describe('AiToolsService (изоляция пользователей)', () => {
  it('читает данные сессионного пользователя, игнорируя userId из аргументов модели', async () => {
    const { context, proposals, seen } = makeStubs();
    const tools = new AiToolsService(context, proposals);

    const execution = await tools.execute('user-a', {
      id: 'call-1',
      name: AI_TOOL_NAMES.transactions,
      arguments: { userId: 'user-b', limit: 5 },
    });

    expect(seen).toEqual(['user-a']);
    expect(execution.proposal).toBeUndefined();
    expect(Array.isArray(execution.result)).toBe(true);
  });

  it('сводка трат тоже привязана к сессии, а не к аргументам', async () => {
    const { context, proposals, seen } = makeStubs();
    const tools = new AiToolsService(context, proposals);

    await tools.execute('user-a', {
      id: 'call-2',
      name: AI_TOOL_NAMES.spendingSummary,
      arguments: { userId: 'user-b', from: '2026-10-01' },
    });

    expect(seen).toEqual(['user-a']);
    expect(context.spendingSummary).toHaveBeenCalledWith('user-a', { from: '2026-10-01', to: undefined, categoryId: undefined });
  });

  it('предложение бюджета сохраняется за сессионным пользователем, ничего не создавая', async () => {
    const { context, proposals, created } = makeStubs();
    const tools = new AiToolsService(context, proposals);

    const execution = await tools.execute('user-a', {
      id: 'call-3',
      name: AI_TOOL_NAMES.proposeBudget,
      arguments: { userId: 'user-b', categoryId: 'cat-1', month: '2026-10', limit: 5000 },
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ userId: 'user-a', kind: 'budget' });
    expect(execution.proposal?.status).toBe('pending');
  });

  it('неизвестный инструмент не роняет цикл', async () => {
    const { context, proposals } = makeStubs();
    const tools = new AiToolsService(context, proposals);

    const execution = await tools.execute('user-a', { id: 'x', name: 'drop_all_data', arguments: {} });
    expect(execution.result).toMatchObject({ error: 'unknown_tool: drop_all_data' });
  });
});

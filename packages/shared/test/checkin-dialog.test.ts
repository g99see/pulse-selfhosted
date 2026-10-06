// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CHECKIN_DIALOG_STEPS,
  checkinAction,
  describeCheckinStep,
  isCheckinAction,
  startCheckinDialog,
  stepCheckinDialog,
  summarizeCheckin,
  type CheckInDialogState,
  type DialogResult,
} from '../src/checkin-dialog';

const act = (state: CheckInDialogState, action: string): DialogResult =>
  stepCheckinDialog(state, { type: 'action', action });
const say = (state: CheckInDialogState, text: string): DialogResult =>
  stepCheckinDialog(state, { type: 'text', text });

function stateOf(result: DialogResult): CheckInDialogState {
  if (result.kind !== 'prompt' && result.kind !== 'ignored') throw new Error(result.kind);
  return result.state;
}

describe('диалог чек-ина', () => {
  it('проходит все шаги и собирает полную запись', () => {
    let state = startCheckinDialog({ slot: 'evening' });
    expect(state.step).toBe('mood');

    state = stateOf(act(state, 'ci:mood:4'));
    expect(state.step).toBe('energy');
    state = stateOf(act(state, 'ci:energy:3'));
    state = stateOf(act(state, 'ci:stress:2'));
    expect(state.step).toBe('sleep');
    state = stateOf(act(state, 'ci:sleep:7'));
    expect(state.step).toBe('tags');
    state = stateOf(act(state, 'ci:tag:1'));
    state = stateOf(say(state, '#йога, чтение'));
    expect(state.data.tags).toEqual(['спорт', 'йога', 'чтение']);
    state = stateOf(act(state, 'ci:tags:done'));
    expect(state.step).toBe('note');

    const result = say(state, 'Хороший вечер');
    expect(result).toEqual({
      kind: 'done',
      input: {
        mood: 4,
        energy: 3,
        stress: 2,
        sleepHours: 7,
        tags: ['спорт', 'йога', 'чтение'],
        note: 'Хороший вечер',
        slot: 'evening',
      },
    });
  });

  it('все необязательные шаги пропускаются, остаётся только настроение', () => {
    let state = stateOf(act(startCheckinDialog({}), 'ci:mood:2'));
    for (const step of ['energy', 'stress', 'sleep'] as const) {
      expect(state.step).toBe(step);
      state = stateOf(act(state, checkinAction(step, 'skip')));
    }
    state = stateOf(act(state, 'ci:tags:done'));
    const result = act(state, 'ci:note:skip');
    expect(result).toMatchObject({ kind: 'done', input: { mood: 2, tags: [] } });
    expect(result.kind === 'done' && result.input.energy).toBeUndefined();
  });

  it('известное настроение (/mood, кнопка напоминания) пропускает первый шаг', () => {
    const state = startCheckinDialog({ mood: 5 });
    expect(state).toMatchObject({ step: 'energy', data: { mood: 5, tags: [] } });
  });

  it('сон текстом: десятичные, запятая, границы', () => {
    const base: CheckInDialogState = { step: 'sleep', data: { mood: 3, tags: [] } };
    expect(stateOf(say(base, '7,5')).data.sleepHours).toBe(7.5);
    expect(say(base, '30').kind).toBe('ignored');
    expect(say(base, 'много').kind).toBe('ignored');
    expect(stateOf(say(base, '7.5')).step).toBe('tags');
  });

  it('кнопка тега переключает отметку, выбранный тег помечается ✓', () => {
    let state: CheckInDialogState = { step: 'tags', data: { mood: 3, tags: [] } };
    state = stateOf(act(state, 'ci:tag:0'));
    expect(state.data.tags).toEqual(['работа']);
    const labels = describeCheckinStep(state).rows[0].map((button) => button.label);
    expect(labels[0]).toBe('✓ работа');
    state = stateOf(act(state, 'ci:tag:0'));
    expect(state.data.tags).toEqual([]);
  });

  it('нажатие кнопки прошлого шага игнорируется и не двигает диалог', () => {
    const state: CheckInDialogState = { step: 'stress', data: { mood: 3, tags: [] } };
    const result = act(state, 'ci:mood:5');
    expect(result.kind).toBe('ignored');
    expect(stateOf(result)).toEqual(state);
    expect(act(state, 'foreign:1').kind).toBe('ignored');
  });

  it('настроение нельзя пропустить, отмена завершает диалог', () => {
    const state = startCheckinDialog({});
    expect(act(state, 'ci:mood:skip').kind).toBe('ignored');
    expect(act(state, 'ci:cancel:1')).toEqual({ kind: 'cancelled' });
  });

  it('текст на шагах шкалы принимает число 1–5', () => {
    const state: CheckInDialogState = { step: 'energy', data: { mood: 3, tags: [] } };
    expect(stateOf(say(state, '4')).data.energy).toBe(4);
    expect(say(state, '9').kind).toBe('ignored');
  });

  it('prompt: номер шага, кнопки укладываются в лимит callback_data', () => {
    for (const step of CHECKIN_DIALOG_STEPS) {
      const prompt = describeCheckinStep({ step, data: { tags: [] } });
      expect(prompt.total).toBe(6);
      for (const button of prompt.rows.flat()) {
        expect(isCheckinAction(button.action)).toBe(true);
        expect(Buffer.byteLength(button.action)).toBeLessThanOrEqual(64);
      }
    }
    const sleep = describeCheckinStep({ step: 'sleep', data: { tags: [] } });
    expect(sleep.rows[0].map((button) => button.label)).toEqual(['4', '5', '6', '7', '8', '9+']);
  });

  it('«Сохранить сейчас» записывает уже собранное, без настроения не работает', () => {
    const state: CheckInDialogState = { step: 'sleep', data: { mood: 4, energy: 2, tags: [] } };
    expect(act(state, 'ci:finish:1')).toMatchObject({
      kind: 'done',
      input: { mood: 4, energy: 2, tags: [] },
    });
    expect(act(startCheckinDialog({}), 'ci:finish:1').kind).toBe('ignored');
  });

  it('summarizeCheckin показывает только заполненные поля', () => {
    expect(summarizeCheckin({ mood: 4, tags: [] }).map((line) => line.field)).toEqual(['mood']);
    const full = summarizeCheckin({
      mood: 4,
      energy: 3,
      stress: 2,
      sleepHours: 7.5,
      tags: ['спорт'],
      note: 'ок',
    });
    expect(full.map((line) => line.field)).toEqual([
      'mood',
      'energy',
      'stress',
      'sleepHours',
      'tags',
      'note',
    ]);
  });
});

// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { t } from '../src/lib/i18n';

describe('строки v2 §7–§8 есть в ru и en', () => {
  const keys = [
    'daySummary.settings.title',
    'daySummary.notFound',
    'checkin.goal.progress',
    'insights.text.sleepSpend',
    'insights.text.energySpend',
    'insights.text.moodSpend',
    'insights.correlations.diff',
    'admin.metrics.title',
    'app.nav.adminMetrics',
  ];

  it('ключи переведены на оба языка и не совпадают с самим ключом', () => {
    for (const key of keys) {
      expect(t(key, 'ru')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(key);
      expect(t(key, 'en')).not.toBe(t(key, 'ru'));
    }
  });

  it('параметры подставляются', () => {
    expect(t('checkin.goal.progress', 'ru', { count: 2, goal: 5 })).toBe(
      '2 из 5 чек-инов на этой неделе',
    );
    expect(t('insights.text.sleepSpend', 'en', { percent: 40, days: 6 })).toContain('40%');
  });
});

#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Генерация собственных VAPID-ключей для web push (ТЗ §3.6).
 * Запуск: pnpm --filter @puls/api vapid:generate
 * Полученные значения положите в окружение как VAPID_PUBLIC_KEY,
 * VAPID_PRIVATE_KEY и VAPID_SUBJECT (см. docs/PHASE1-NOTIFICATIONS.md).
 */
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

console.log('# Ключи VAPID для web push «Пульса»');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:admin@example.com');

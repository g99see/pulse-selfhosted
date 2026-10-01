// SPDX-License-Identifier: AGPL-3.0-or-later
import { testEnv } from './test-env';

// Выполняется в каждом воркере до импорта тестов: тестовая схема БД,
// in-memory лимитер и дешёвый Argon2.
Object.assign(process.env, testEnv());

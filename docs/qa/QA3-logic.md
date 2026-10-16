# QA-3 — логика анкеты чек-ина (аудит)

Репозиторий: `~/Projects/dev/puls` @ `cac4e2a` (read-only). Пруфы: `qa/qa3-proof.mjs`, `qa/qa3-tz.mjs` (в этой же папке). Прогоны воспроизводят реальные функции из репо.

Формат: **S | файл:строка | что | фикс.**

---

## CRITICAL / HIGH

**1. C | `packages/shared/src/insights.ts:356-364` + `apps/api/src/insights/insights.service.ts:102` | Сигнал `wellbeing_concern` можно «скрыть» оценкой «не полезно»: `hiddenInsightTypes` не исключает этот тип, `rankInsights`/`selectWeeklyInsights` его отфильтровывают, а `list()` считает `hasConcern` по сохранённым строкам — исчезает и карточка заботы, и блок телефонов поддержки.** | Никогда не скрывать: `filter(s => s.type !== 'wellbeing_concern')` в `hiddenInsightTypes` (или явный deny-list). Добавить тест. Пруф: `node qa3-proof.mjs` §4.

**2. H | `packages/shared/src/checkin.ts:193-195` | `dayBoundsInTimeZone` жёстко берёт 24 ч (`start + 24*60*60*1000`) и выводит смещение из времени суток переданной даты, поэтому в дни DST границы суток сдвигаются на ±1 ч и окно всегда 24 ч вместо 23/25. Используется в «чек-ины за сегодня» (`checkins.service.ts:168`) и в недельной цели (`:126`).** | Считать `end` независимо: `zonedDayBounds(addDays(dayKey,1), tz).start` (или переиспользовать `zonedDayBounds`). Пруф: `qa3-tz.mjs` (Europe/Berlin: вызов 25.10 10:00Z → start 24.10 23:00Z вместо 22:00Z).

**3. H | `packages/shared/src/stats.ts:41-53` | `zonedTimeToUtc` не проверяет результат: в зонах, где переход DST происходит ровно в местную полночь (полночи не существует), старт суток попадает в ПРЕДЫДУЩИЙ локальный день — час вчерашних данных уходит в сегодня (статистика, корреляции, `zonedDayBounds`).** | После сходимости проверить `dayKeyInTimezone(new Date(t), tz) === dayKey` и сдвигать по локальному гэпу. Пруф: `qa3-tz.mjs` — 5 несовпадений на 418 зон × 10 дней (America/Havana 2026-03-08, America/Santiago 2026-09-06, Atlantic/Azores 2026-03-29/2027-03-28).

**4. H | `apps/web/src/app/(app)/checkin/page.tsx:71-74,166,172` vs `apps/api/src/checkins/checkins.service.ts:88,102` | Веб решает «утро» по поясу БРАУЗЕРА (`Intl…resolvedOptions().timeZone`) и шлёт `slot` по часам БРАУЗЕРА (`slotForHour(getHours())`), а сервер гейтит сон по поясу ПРОФИЛЯ и берёт `slot: input.slot ?? null` без пересчёта. При расхождении поясов введённый сон молча теряется (сервер ставит null), а слот остаётся неверным.** | Сервер должен пересчитывать `slot` сам (`slotForUserHour(now, user.timezone)`) и игнорировать клиентский. Пруф: `qa3-proof.mjs` §6.

**5. H | `apps/api/src/stats/stats.service.ts:169,178-187` | `day()` пересчитывает кеш DailyStat только за запрошенный день, но `monthSpent` берёт из DailyStat за весь месяц. Строки за другие дни существуют, только если их кто-то запрашивал → `budgetRemaining` завышается.** | Перед чтением пересчитывать весь месяц: `recomputeRange(userId, tz, from, to)`, либо суммировать расход прямо из `transaction`. Смежно: `insights.service.ts:122-129` читает DailyStat для корреляций без `recomputeRange` → корреляции зависят от того, какие экраны открывал пользователь.

**6. M | `packages/shared/src/checkin.ts:29-30` / `apps/api/src/checkins/checkin-dialog.service.ts:54` / `apps/api/src/notifications/messages.ts:41-51` | Три разных определения «утра»: сон 04:00–12:00, слот `hour<12`, приветствие 05:00–11:00. В 04:00 спрашивают сон при приветствии «Как вы?»; в 11:00 приветствие «Как проходит день?», но шаг сна ещё есть; в 00:00–03:59 слот = `morning` без шага сна.** | Свести к одной константе (один диапазон и один слот-порог) и экспортировать. Пруф: `qa3-proof.mjs` §1.

---

## MEDIUM

**7. M | `packages/shared/src/insights.ts:147-151,311-314` | Сирии `low_energy_streak` и `wellbeing_concern` идут с конца и рвутся на первом `null`: если сегодня чек-ина ещё нет, сигнал не выдаётся вовсе — человек, переставший отмечаться, теряет и заботу, и инсайт.** | Не требовать сегодняшнего дня: считать «последние подряд идущие дни с данными». Пруф: `qa3-proof.mjs` §2.

**8. M | `packages/shared/src/correlations.ts:16,18` | `CORRELATION_MIN_SAMPLES = 4` и порог 15 % дают «значимый» вывод на 4+4 днях: одна импульсная покупка 4000 ₽ → инсайт «+900 %». Тон текста (`i18n.ts:938-943`) звучит как факт, а не как наблюдение.** | Поднять минимум (≥8–10 в группе), добавить устойчивость (медиана / отсечение выбросов) и явно помечать «наблюдение, не причина». Пруф: `qa3-proof.mjs` §3.

**9. M | `apps/api/src/stats/stats.service.ts:121,263,304` | DailyStat и агрегаты чек-инов группируются по `createdAt`, а остальное приложение — по `occurredAt` (бэкдейт до 24 ч, `checkins.service.ts:81`). Чек-ин, заполненный 00:10 «за вчера», в UI попадает во вчера, а в статистику — в сегодня.** | Группировать по `dayKeyInTimezone(checkIn.occurredAt, tz)` и фильтровать периоды по `occurredAt`.

**10. M | `apps/api/src/achievements/achievements.service.ts:296,32` | `longest` в StreakDto считается из скользящего окна 370 дней → реальный лучший стрик за всё время занижается (400 дней → 371).** | Считать `longest` по всем чек-инам (как метрика `checkin_streak_best`), окном ограничивать только `current`.

**11. M | `apps/api/src/achievements/achievements.service.ts:313` | Плашка серии считает `nextMilestone` от `Math.max(current, longest)` — прогресс показывается от мёртвого стрика («3/100» при текущем 3).** | Базис — только `current`; `longest` отдавать отдельно.

**12. M | `apps/api/src/achievements/metrics.ts:191-193` | `longestStreak` передаёт все ключи дней в `computeStreak`, чей цикл считает серии и за `today` → будущая дата транзакции завышает стрик-бейджи.** | Отфильтровать `days <= todayKey`.

**13. M | `packages/shared/src/stats.ts:258-282` + `apps/api/src/stats/stats.service.ts:212,374` | `previousPeriodRange` возвращает ПОЛНЫЙ прошлый период → сравнение «полный сентябрь vs 3 дня октября», а `series` добивает текущий месяц/год будущими нулями.** | Для неоконченного периода обрезать прошлый до той же длины; `series` ограничивать «сегодня».

**14. M | `apps/api/src/achievements/achievements.service.ts:240` | GET-чтение достижений вызывает `run(..., {})` без `silent` → открытие экрана само выдаёт достижения и рассылает уведомления/вебхуки.** | `{ silent: true }` на ленивом чтении.

---

## LOW

**15. L | `apps/api/src/checkins/checkins.service.ts:193-206` | `update()` при `sleepHours` вне окна ставит `data.sleepHours = null` — если клиент пришлёт новый `occurredAt` (например `now`) при правке утреннего чек-ина вечером, записанный сон стирается.** | Не затирать: игнорировать правку, а не писать null.

**16. L | `packages/shared/src/checkin-dialog.ts:306-310` | `countValue` не понимает `1,5k` и `10 к` (возвращает null → «ignored»); при этом `k` без пробела работает.** | Нормализовать запятую/пробелы до `Number`.

**17. L | `packages/shared/src/checkin-parser.ts:65-75` | Ключевое слово без числа после него молча становится словом заметки: `/checkin 4 сон мало` → «сон мало» в заметке, без ошибки.** | При ключевом слове без валидного значения возвращать `error:'value', field`.

**18. L | `packages/shared/src/checkin-dialog.ts:47,190-193` | Кнопка «9+» пишет ровно `sleepHours = 9`, а не «≥9» → `avgSleep`/метрика `checkin_sleep_days` занижаются.** | Хранить 9 как «≥9» (отдельный флаг) или поднять значение до 10 и переименовать подпись.

**19. L | `packages/shared/src/mood.ts:32-37` | `moodAverage` фильтрует `isMood` (только целые 1–5) и молча теряет дробные: `moodAverage([2.3, 5]) === 5`.** | Фильтровать по диапазону (`Number.isFinite && 1..5`), как в `optionalAverage`.

**20. L | `packages/shared/src/stats.ts:115` | `roundMoney` округляет половины к +∞: `roundMoney(-1.005) === -1`, а `+1.005 === 1.01`; влияет на отрицательный `budgetRemaining` и `net`.** | Знако-зависимое округление.

**21. L | `apps/api/src/notifications/scheduler.ts:186-197` + `outbox.service.ts:56-76` | При работе без `REDIS_URL` (таймер в процессе) на нескольких репликах нет дедупликации: каждая реплика со своим `lastRunAt` поставит одно и то же плановое уведомление → дубли.** | Дедуп по `(userId, channel, type, slotInstant)` в БД (unique) или требовать Valkey при >1 инстансе.

**22. L | `apps/api/src/checkins/checkin-dialog.service.ts:157-180,183` | `flushExpired` пишет чек-ин на `draft.createdAt` (верно), но `handle` продлевает TTL на каждом шаге — «черновик 30 минут без ответов» может жить часами и через полночь записать чек-ин во вчерашний день.** | Ограничить абсолютный возраст черновика (например, 2 ч) помимо продления.

---

## Непокрытые ветки (нет тестов)

- DST-границы: `dayBoundsInTimeZone` покрыт только UTC/Moscow (`checkin-schedule.test.ts:61,70`), кейс «полночь не существует» в `zonedTimeToUtc` — не покрыт; `isMorningForSleep` тестируется только в UTC/стабильных зонах (`sleep-morning.test.ts:11-26`).
- `flushExpired` (спасение брошенного черновика) — юнит-теста нет.
- Скрытие `wellbeing_concern` фидбеком — не покрыто.
- Расхождение пояс «браузер vs профиль» (находки 4) — не покрыто.
- `correlations` при пустом/частичном DailyStat — не покрыто.

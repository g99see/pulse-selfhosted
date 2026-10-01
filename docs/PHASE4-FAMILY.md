# Фаза 4, блок D — семейный режим

Реализация ТЗ §4 (пункт «семейный режим»): общие счета и цели семьи на одном
домашнем сервере, а у каждого участника — свой приватный дневник. Личные
`Account`/`Goal`/`CheckIn`/`Transaction` не меняются и семье не видны —
приватность дневника закреплена тестом.

Модель: `Family` (id, name, owner), `FamilyMember` (family_id, user_id, role
`owner|member`, joined_at), `FamilyInvite` (код, срок, одноразовость). Общие
сущности — отдельные таблицы `FamilyAccount` (с балансом) и `FamilyGoal` со
взносами `FamilyGoalDeposit` (каждый взнос с `user_id` — кто внёс).

## Эндпоинты (префикс `/api/family`, все под `SessionGuard`)

| Метод | Путь | Кто | Назначение |
| --- | --- | --- | --- |
| GET | `/` | любой участник | Моя семья с участниками (`family: null`, если семьи нет) |
| POST | `/` | любой | Создать семью (создатель — владелец) |
| DELETE | `/` | владелец | Удалить семью и все общие данные |
| POST | `/invites` | владелец | Создать одноразовый код-приглашение со сроком |
| POST | `/join` | любой | Вступить по коду (один пользователь — одна семья) |
| DELETE | `/members/:userId` | владелец | Исключить участника |
| POST | `/leave` | участник | Выйти из семьи (владелец — нет) |
| GET | `/accounts` | участник | Общие счета и суммарный баланс |
| POST | `/accounts` | участник | Создать общий счёт |
| PUT | `/accounts/:id` | участник | Правка общего счёта |
| DELETE | `/accounts/:id` | участник | Удалить общий счёт |
| GET | `/accounts/:id/transactions` | участник | История операций по счёту |
| POST | `/accounts/:id/transactions` | участник | Доход/расход: кто внёс — сессия, баланс пересчитывается |
| GET | `/goals` | участник | Общие цели с прогрессом |
| POST | `/goals` | участник | Создать общую цель |
| PUT | `/goals/:id` | участник | Правка общей цели |
| DELETE | `/goals/:id` | участник | Удалить общую цель |
| POST | `/goals/:id/deposit` | участник | Взнос участника в общую цель |

Ошибки в едином формате `{ code, message }`: `validation_error`,
`family_not_found`, `family_forbidden` (403), `family_already_member` (409),
`family_full` (409), `family_owner_cannot_remove` / `family_owner_cannot_leave`
(409), `invite_not_found` (404), `account_not_found` / `goal_not_found` /
`member_not_found` (404), `unauthorized`.

Права: все участники читают и вносят; владелец управляет составом, создаёт
приглашения и удаляет семью. Кросс-семейный доступ к чужому счёту или цели —
`404` (чужой идентификатор неотличим от несуществующего).

## Данные (ТЗ §7)

Миграция — `apps/api/prisma/migrations/20261001150810_family` (создаёт
`families`, `family_members`, `family_invites`, `family_accounts`,
`family_transactions`, `family_goals`, `family_goal_deposits`). Суммы —
`Decimal(14,2)`. `family_members.user_id` уникален — один пользователь в одной
семье. `family_invites.code` уникален; после вступления проставляются
`used_at`/`used_by` (одноразовость), срок — `expires_at`.

Таблицы с колонкой `user_id` добавлены в `apps/api/src/account/data-registry.ts`
(`family_members`, `family_transactions`, `family_goal_deposits`) — покрыты
экспортом и тестом реестра. `families`/`family_invites`/`family_accounts`/
`family_goals` колонки `user_id` не имеют (владелец — `owner_id`, автор — через
`created_by`/`used_by`).

## Чистые функции (`@puls/shared/src/family.ts`, ТЗ §4)

- `familyBalanceDelta(kind, amount)` / `applyFamilyTransaction(balance, kind,
  amount)` — доход «+», расход «−».
- `isFamilyInviteActive(invite, now)` — не использован и не истёк.
- `familyGoalSummary(saved, target, deadline, deposits, from)` — прогресс,
  остаток, нужный взнос в месяц, прогноз даты и вехи: переиспользует
  `goalProgress` / `requiredMonthlyContribution` / `goalPacePerMonth` /
  `forecastGoalDate` / `reachedMilestones` из `shared/src/goals.ts`.

## Web

- `/family` — создание семьи или вступление по коду; карточка семьи (участники,
  роль, исключение, выход/удаление); приглашение с копированием кода; общие
  счета с операциями доход/расход и историей; общие цели с кольцом прогресса и
  формой взноса.
- Пункт навигации `app.nav.family` в `components/app-shell.tsx`.
- Клиент `lib/family-client.ts` через `authFetch`.
- Все строки интерфейса — в `src/lib/i18n.ts` (ru/en, одинаковые ключи).

## Приватность дневника (ТЗ §4, §7)

Частный дневник отдают свои модули (`/api/checkins`, `/api/finance`,
`/api/goals`), каждый фильтрует по `user_id` сессии. Семья доступа к ним не
добавляет: интеграционный тест «Приватность дневника» проверяет, что участник
семьи не видит личные чек-ины, цели и счета другого участника ни одним
эндпоинтом, при этом общие данные семьи ему доступны.

## Тесты

- `packages/shared/test/family.test.ts` — unit схем и расчётов.
- `apps/api/test/family.integration.test.ts` — 12 интеграционных тестов:
  семья и приглашения, роли, одноразовый код, общий счёт и пересчёт баланса,
  общая цель и взносы, кросс-семейная изоляция, приватность дневника, 401.
- `apps/web/e2e/family.spec.ts` — создание семьи, приглашение вторым
  пользователем, взнос в общую цель и проверка, что личный чек-ин участника не
  виден владельцу.

Новые переменные окружения не добавлялись.

-- CATALOG (ТЗ v2 §8, §9): расширенное дерево категорий, стабильные ключи и
-- родительские связи, таблица личных магазинов пользователя.
--
-- Категории: старые системные строки сохраняют свои id (sys-food, sys-transport…),
-- поэтому история транзакций не теряется — миграция лишь дополняет их ключом и
-- родителем и добавляет недостающие строки. Обновление идемпотентно по id.

-- AlterTable: ключ стандартной категории и родитель для подкатегорий.
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "key" TEXT;
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parent_id" TEXT;

-- CreateTable: личные магазины пользователя (ТЗ §9).
CREATE TABLE IF NOT EXISTS "user_merchants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "pattern" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_merchants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_merchants_user_id_idx" ON "user_merchants"("user_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "user_merchants_category_id_idx" ON "user_merchants"("category_id");

-- Seed: полный стандартный набор категорий (30 верхних + 33 подкатегории).
-- Родители объявлены раньше детей, поэтому внешний ключ parent_id резолвится.
INSERT INTO "categories" ("id", "user_id", "name", "icon", "color", "kind", "is_system", "key", "parent_id") VALUES
  ('sys-food', NULL, 'Еда', 'utensils', '#2BA889', 'expense', true, 'food', NULL),
  ('sys-groceries', NULL, 'Продукты', 'shopping-cart', '#2BA889', 'expense', true, 'groceries', NULL),
  ('sys-cafe', NULL, 'Кафе и рестораны', 'coffee', '#F2A25C', 'expense', true, 'cafe', NULL),
  ('sys-transport', NULL, 'Транспорт', 'bus', '#5B5BD6', 'expense', true, 'transport', NULL),
  ('sys-taxi', NULL, 'Такси', 'car', '#5B5BD6', 'expense', true, 'taxi', NULL),
  ('sys-housing', NULL, 'Жильё', 'house', '#F2A25C', 'expense', true, 'housing', NULL),
  ('sys-utilities', NULL, 'Коммунальные', 'zap', '#F2A25C', 'expense', true, 'utilities', NULL),
  ('sys-connectivity', NULL, 'Связь и интернет', 'smartphone', '#6E6E7A', 'expense', true, 'connectivity', NULL),
  ('sys-health', NULL, 'Здоровье', 'heart-pulse', '#D9638C', 'expense', true, 'health', NULL),
  ('sys-pharmacy', NULL, 'Аптека', 'pill', '#D9638C', 'expense', true, 'pharmacy', NULL),
  ('sys-sport', NULL, 'Спорт', 'dumbbell', '#3DD6AE', 'expense', true, 'sport', NULL),
  ('sys-beauty', NULL, 'Красота', 'sparkles', '#D9638C', 'expense', true, 'beauty', NULL),
  ('sys-clothes', NULL, 'Одежда', 'shirt', '#8B8BF5', 'expense', true, 'clothes', NULL),
  ('sys-electronics', NULL, 'Электроника', 'laptop', '#8B8BF5', 'expense', true, 'electronics', NULL),
  ('sys-subscriptions', NULL, 'Подписки', 'repeat', '#5B5BD6', 'expense', true, 'subscriptions', NULL),
  ('sys-entertainment', NULL, 'Развлечения', 'party-popper', '#D9638C', 'expense', true, 'entertainment', NULL),
  ('sys-travel', NULL, 'Путешествия', 'plane', '#3DD6AE', 'expense', true, 'travel', NULL),
  ('sys-education', NULL, 'Образование', 'book', '#5B5BD6', 'expense', true, 'education', NULL),
  ('sys-gifts', NULL, 'Подарки', 'gift', '#D9638C', 'expense', true, 'gifts', NULL),
  ('sys-kids', NULL, 'Дети', 'baby', '#F2A25C', 'expense', true, 'kids', NULL),
  ('sys-pets', NULL, 'Питомцы', 'paw-print', '#F2A25C', 'expense', true, 'pets', NULL),
  ('sys-taxes-fees', NULL, 'Налоги и комиссии', 'receipt', '#6E6E7A', 'expense', true, 'taxes_fees', NULL),
  ('sys-transfers', NULL, 'Переводы', 'arrow-left-right', '#6E6E7A', 'expense', true, 'transfers', NULL),
  ('sys-cash', NULL, 'Наличные', 'wallet', '#6E6E7A', 'expense', true, 'cash', NULL),
  ('sys-savings', NULL, 'Накопления', 'piggy-bank', '#2BA889', 'expense', true, 'savings', NULL),
  ('sys-shopping', NULL, 'Покупки', 'shopping-bag', '#8B8BF5', 'expense', true, 'shopping', NULL),
  ('sys-other', NULL, 'Прочее', 'circle-ellipsis', '#6E6E7A', 'expense', true, 'other', NULL),
  ('sys-groceries-delivery', NULL, 'Доставка продуктов', 'truck', '#2BA889', 'expense', true, 'groceries_delivery', 'sys-groceries'),
  ('sys-restaurants', NULL, 'Рестораны', 'utensils', '#F2A25C', 'expense', true, 'restaurants', 'sys-cafe'),
  ('sys-coffee', NULL, 'Кофейни', 'coffee', '#F2A25C', 'expense', true, 'coffee', 'sys-cafe'),
  ('sys-fast-food', NULL, 'Фастфуд', 'sandwich', '#F2A25C', 'expense', true, 'fast_food', 'sys-cafe'),
  ('sys-food-delivery', NULL, 'Доставка еды', 'truck', '#F2A25C', 'expense', true, 'food_delivery', 'sys-cafe'),
  ('sys-bars', NULL, 'Бары', 'beer', '#F2A25C', 'expense', true, 'bars', 'sys-cafe'),
  ('sys-public-transport', NULL, 'Общественный транспорт', 'train', '#5B5BD6', 'expense', true, 'public_transport', 'sys-transport'),
  ('sys-fuel', NULL, 'Бензин', 'fuel', '#5B5BD6', 'expense', true, 'fuel', 'sys-transport'),
  ('sys-parking', NULL, 'Парковка', 'parking', '#5B5BD6', 'expense', true, 'parking', 'sys-transport'),
  ('sys-car', NULL, 'Авто', 'car', '#5B5BD6', 'expense', true, 'car', 'sys-transport'),
  ('sys-bike-scooter', NULL, 'Велосипед и самокат', 'bike', '#5B5BD6', 'expense', true, 'bike_scooter', 'sys-transport'),
  ('sys-rent', NULL, 'Аренда', 'house', '#F2A25C', 'expense', true, 'rent', 'sys-housing'),
  ('sys-home-goods', NULL, 'Дом и ремонт', 'hammer', '#F2A25C', 'expense', true, 'home_goods', 'sys-housing'),
  ('sys-electricity', NULL, 'Электричество', 'zap', '#F2A25C', 'expense', true, 'electricity', 'sys-utilities'),
  ('sys-water-heating', NULL, 'Вода и отопление', 'droplet', '#F2A25C', 'expense', true, 'water_heating', 'sys-utilities'),
  ('sys-mobile', NULL, 'Мобильная связь', 'smartphone', '#6E6E7A', 'expense', true, 'mobile', 'sys-connectivity'),
  ('sys-home-internet', NULL, 'Домашний интернет', 'wifi', '#6E6E7A', 'expense', true, 'home_internet', 'sys-connectivity'),
  ('sys-doctors', NULL, 'Врачи и анализы', 'stethoscope', '#D9638C', 'expense', true, 'doctors', 'sys-health'),
  ('sys-dentist', NULL, 'Стоматология', 'smile', '#D9638C', 'expense', true, 'dentist', 'sys-health'),
  ('sys-gym', NULL, 'Залы и абонементы', 'dumbbell', '#3DD6AE', 'expense', true, 'gym', 'sys-sport'),
  ('sys-sport-goods', NULL, 'Спорттовары', 'bike', '#3DD6AE', 'expense', true, 'sport_goods', 'sys-sport'),
  ('sys-hairdresser', NULL, 'Парикмахерская', 'scissors', '#D9638C', 'expense', true, 'hairdresser', 'sys-beauty'),
  ('sys-cosmetics', NULL, 'Косметика', 'sparkles', '#D9638C', 'expense', true, 'cosmetics', 'sys-beauty'),
  ('sys-music-video', NULL, 'Музыка и видео', 'play', '#5B5BD6', 'expense', true, 'music_video', 'sys-subscriptions'),
  ('sys-software', NULL, 'Сервисы и софт', 'cloud', '#5B5BD6', 'expense', true, 'software', 'sys-subscriptions'),
  ('sys-games', NULL, 'Игры', 'gamepad', '#D9638C', 'expense', true, 'games', 'sys-entertainment'),
  ('sys-cinema-events', NULL, 'Кино и события', 'ticket', '#D9638C', 'expense', true, 'cinema_events', 'sys-entertainment'),
  ('sys-flights', NULL, 'Авиабилеты', 'plane', '#3DD6AE', 'expense', true, 'flights', 'sys-travel'),
  ('sys-hotels', NULL, 'Жильё в поездках', 'bed', '#3DD6AE', 'expense', true, 'hotels', 'sys-travel'),
  ('sys-intercity', NULL, 'Междугородний транспорт', 'train', '#3DD6AE', 'expense', true, 'intercity', 'sys-travel'),
  ('sys-clothes-shoes', NULL, 'Обувь', 'shirt', '#8B8BF5', 'expense', true, 'clothes_shoes', 'sys-clothes'),
  ('sys-marketplace', NULL, 'Маркетплейсы', 'shopping-bag', '#8B8BF5', 'expense', true, 'marketplace', 'sys-shopping'),
  ('sys-bank-fees', NULL, 'Комиссии банка', 'receipt', '#6E6E7A', 'expense', true, 'bank_fees', 'sys-taxes-fees'),
  ('sys-salary', NULL, 'Зарплата', 'banknote', '#2BA889', 'income', true, 'salary', NULL),
  ('sys-refunds', NULL, 'Возвраты', 'undo', '#2BA889', 'income', true, 'refunds', NULL),
  ('sys-other-income', NULL, 'Прочий доход', 'plus', '#2BA889', 'income', true, 'other_income', NULL)
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "icon" = EXCLUDED."icon",
  "color" = EXCLUDED."color",
  "kind" = EXCLUDED."kind",
  "is_system" = true,
  "key" = EXCLUDED."key",
  "parent_id" = EXCLUDED."parent_id";

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "categories_key_key" ON "categories"("key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "categories_parent_id_idx" ON "categories"("parent_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_merchants" ADD CONSTRAINT "user_merchants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_merchants" ADD CONSTRAINT "user_merchants_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

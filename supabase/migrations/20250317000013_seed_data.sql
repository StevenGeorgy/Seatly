-- Seed data: 2 restaurants, tables, shifts, menu categories, menu items
-- Test user accounts: Run `npx tsx scripts/seed-users.ts` after this migration.
-- Creates owner1@seatly.test, host1@seatly.test (La Maison), owner2@seatly.test, host2@seatly.test (The Local)

-- Restaurant 1: La Maison
INSERT INTO restaurants (
  name, slug, cuisine_type, description, address, city, province, country,
  phone, email, business_type, timezone, currency, tax_rate, plan, is_active
) VALUES (
  'La Maison',
  'la-maison',
  'French',
  'Upscale French fine dining in the heart of Toronto.',
  '123 King Street West',
  'Toronto',
  'Ontario',
  'Canada',
  '+1-416-555-0100',
  'contact@lamaison.ca',
  'fine_dining',
  'America/Toronto',
  'CAD',
  0.13,
  'starter',
  true
);

-- Restaurant 2: The Local
INSERT INTO restaurants (
  name, slug, cuisine_type, description, address, city, province, country,
  phone, email, business_type, timezone, currency, tax_rate, plan, is_active
) VALUES (
  'The Local',
  'the-local',
  'American',
  'Casual neighbourhood spot with craft beers and comfort food.',
  '456 Queen Street East',
  'Toronto',
  'Ontario',
  'Canada',
  '+1-416-555-0200',
  'hello@thelocal.ca',
  'casual',
  'America/Toronto',
  'CAD',
  0.13,
  'free',
  true
);

-- Tables for La Maison (5 tables)
INSERT INTO "tables" (restaurant_id, table_number, capacity, section, position_x, position_y, shape, status)
SELECT id, '1', 2, 'Main floor', 100, 100, 'round', 'empty' FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, '2', 4, 'Main floor', 200, 100, 'rectangle', 'empty' FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, '3', 4, 'Main floor', 300, 100, 'rectangle', 'empty' FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, '4', 6, 'Patio', 100, 200, 'rectangle', 'empty' FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, '5', 2, 'Bar', 200, 200, 'square', 'empty' FROM restaurants WHERE slug = 'la-maison';

-- Tables for The Local (5 tables)
INSERT INTO "tables" (restaurant_id, table_number, capacity, section, position_x, position_y, shape, status)
SELECT id, '1', 4, 'Main floor', 50, 50, 'rectangle', 'empty' FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, '2', 2, 'Main floor', 150, 50, 'square', 'empty' FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, '3', 6, 'Patio', 50, 150, 'rectangle', 'empty' FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, '4', 4, 'Bar', 150, 150, 'rectangle', 'empty' FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, '5', 8, 'Private room', 250, 100, 'rectangle', 'empty' FROM restaurants WHERE slug = 'the-local';

-- Shifts for La Maison (Lunch, Dinner)
INSERT INTO shifts (restaurant_id, name, days_of_week, start_time, end_time, slot_duration_minutes, max_covers, turn_time_minutes, min_party_size, max_party_size, advance_booking_days, is_active)
SELECT id, 'Lunch', ARRAY[1,2,3,4,5], '11:00'::time, '15:00'::time, 30, 40, 90, 1, 8, 30, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Dinner', ARRAY[1,2,3,4,5,6], '17:00'::time, '23:00'::time, 30, 60, 120, 1, 10, 30, true FROM restaurants WHERE slug = 'la-maison';

-- Shifts for The Local (Lunch, Dinner)
INSERT INTO shifts (restaurant_id, name, days_of_week, start_time, end_time, slot_duration_minutes, max_covers, turn_time_minutes, min_party_size, max_party_size, advance_booking_days, is_active)
SELECT id, 'Lunch', ARRAY[1,2,3,4,5], '11:00'::time, '15:00'::time, 15, 50, 60, 1, 12, 14, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Dinner', ARRAY[1,2,3,4,5,6,0], '17:00'::time, '23:00'::time, 15, 80, 90, 1, 12, 14, true FROM restaurants WHERE slug = 'the-local';

-- Menu categories for La Maison
INSERT INTO menu_categories (restaurant_id, name, sort_order, is_active)
SELECT id, 'Starters', 1, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Mains', 2, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Desserts', 3, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Drinks', 4, true FROM restaurants WHERE slug = 'la-maison';

-- Menu categories for The Local
INSERT INTO menu_categories (restaurant_id, name, sort_order, is_active)
SELECT id, 'Starters', 1, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Mains', 2, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Desserts', 3, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Drinks', 4, true FROM restaurants WHERE slug = 'the-local';

-- Menu items for La Maison
INSERT INTO menu_items (restaurant_id, name, description, price, category, sort_order, is_active, is_available)
SELECT id, 'French Onion Soup', 'Classic soup with gruyère crouton', 14.00, 'Starters', 1, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Escargots', 'Burgundy snails in garlic herb butter', 18.00, 'Starters', 2, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Duck Confit', 'Slow-cooked duck leg with pommes dauphine', 38.00, 'Mains', 1, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Steak Frites', '8oz ribeye with béarnaise and frites', 42.00, 'Mains', 2, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Bouillabaisse', 'Provençal fish stew with rouille', 36.00, 'Mains', 3, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Crème Brûlée', 'Vanilla custard with caramelized sugar', 12.00, 'Desserts', 1, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Tarte Tatin', 'Caramelized apple tart with crème fraîche', 14.00, 'Desserts', 2, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'House Red Wine', 'Glass of Côtes du Rhône', 12.00, 'Drinks', 1, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Champagne', 'Glass of Moët & Chandon', 18.00, 'Drinks', 2, true, true FROM restaurants WHERE slug = 'la-maison'
UNION ALL SELECT id, 'Espresso', 'Single origin espresso', 4.00, 'Drinks', 3, true, true FROM restaurants WHERE slug = 'la-maison';

-- Menu items for The Local
INSERT INTO menu_items (restaurant_id, name, description, price, category, sort_order, is_active, is_available)
SELECT id, 'Wings', 'Crispy wings with choice of sauce', 14.00, 'Starters', 1, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Poutine', 'Quebec-style fries with cheese curds and gravy', 12.00, 'Starters', 2, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Burger', 'Angus beef with lettuce, tomato, pickles', 18.00, 'Mains', 1, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Fish & Chips', 'Beer-battered cod with house fries', 22.00, 'Mains', 2, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Mac & Cheese', 'Three-cheese with crispy breadcrumb topping', 16.00, 'Mains', 3, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Chocolate Brownie', 'Warm brownie with vanilla ice cream', 10.00, 'Desserts', 1, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Apple Pie', 'Classic apple pie with cinnamon', 9.00, 'Desserts', 2, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'IPA', 'Local craft IPA 16oz', 8.00, 'Drinks', 1, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'House Lager', 'Crisp lager 16oz', 7.00, 'Drinks', 2, true, true FROM restaurants WHERE slug = 'the-local'
UNION ALL SELECT id, 'Caesar', 'Canadian Caesar with Clamato', 12.00, 'Drinks', 3, true, true FROM restaurants WHERE slug = 'the-local';

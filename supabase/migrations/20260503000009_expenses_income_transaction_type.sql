-- Add income support to the finance ledger.
-- Existing rows remain expenses; income rows use the same ledger tables with
-- transaction_type = 'income' so reporting never depends on negative amounts.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'expense'
    CHECK (transaction_type IN ('expense', 'income'));

ALTER TABLE recurring_expense_rules
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'expense'
    CHECK (transaction_type IN ('expense', 'income'));

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_category_check;

ALTER TABLE recurring_expense_rules
  DROP CONSTRAINT IF EXISTS recurring_expense_rules_category_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_category_check CHECK (
    category IN (
      'food_cost',
      'food_supplies',
      'beverages',
      'utilities',
      'rent',
      'equipment',
      'marketing',
      'staff',
      'supplies',
      'maintenance',
      'cleaning',
      'sales',
      'preorders',
      'events',
      'catering',
      'delivery',
      'gift_cards',
      'other'
    )
  );

ALTER TABLE recurring_expense_rules
  ADD CONSTRAINT recurring_expense_rules_category_check CHECK (
    category IN (
      'food_cost',
      'food_supplies',
      'beverages',
      'utilities',
      'rent',
      'equipment',
      'marketing',
      'staff',
      'supplies',
      'maintenance',
      'cleaning',
      'sales',
      'preorders',
      'events',
      'catering',
      'delivery',
      'gift_cards',
      'other'
    )
  );

CREATE INDEX IF NOT EXISTS expenses_restaurant_type_date_idx
  ON expenses (restaurant_id, transaction_type, expense_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS recurring_expense_rules_restaurant_type_due_idx
  ON recurring_expense_rules (restaurant_id, transaction_type, next_due_date)
  WHERE is_active = TRUE;

-- Expense ledger and recurring bill rules.
-- Actual paid/due costs live in expenses; recurring_expense_rules stores templates
-- used for forecasting monthly operating cost and generating future bills.

CREATE TABLE IF NOT EXISTS expenses (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id      UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category           TEXT NOT NULL CHECK (
    category IN (
      'food_cost',
      'beverages',
      'utilities',
      'rent',
      'equipment',
      'marketing',
      'staff',
      'supplies',
      'maintenance',
      'other'
    )
  ),
  vendor_name        TEXT,
  description        TEXT,
  notes              TEXT,
  amount             NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_amount         NUMERIC DEFAULT 0 CHECK (tax_amount IS NULL OR tax_amount >= 0),
  total_amount       NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency           TEXT NOT NULL DEFAULT 'cad',
  expense_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_status     TEXT NOT NULL DEFAULT 'paid' CHECK (
    payment_status IN ('paid', 'due', 'scheduled', 'overdue')
  ),
  paid_at            TIMESTAMPTZ,
  recurring_rule_id  UUID,
  receipt_url        TEXT,
  receipt_type       TEXT CHECK (receipt_type IS NULL OR receipt_type IN ('image', 'pdf')),
  ai_categorized     BOOLEAN NOT NULL DEFAULT FALSE,
  ai_extracted_data  JSONB,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at         TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS recurring_expense_rules (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id      UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  vendor_name        TEXT NOT NULL,
  category           TEXT NOT NULL CHECK (
    category IN (
      'food_cost',
      'beverages',
      'utilities',
      'rent',
      'equipment',
      'marketing',
      'staff',
      'supplies',
      'maintenance',
      'other'
    )
  ),
  description        TEXT,
  amount             NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  tax_amount         NUMERIC DEFAULT 0 CHECK (tax_amount IS NULL OR tax_amount >= 0),
  total_amount       NUMERIC NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency           TEXT NOT NULL DEFAULT 'cad',
  frequency          TEXT NOT NULL CHECK (
    frequency IN ('weekly', 'bi_weekly', 'monthly', 'quarterly', 'yearly')
  ),
  interval_count     INTEGER NOT NULL DEFAULT 1 CHECK (interval_count >= 1),
  start_date         DATE NOT NULL DEFAULT CURRENT_DATE,
  next_due_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date           DATE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (
    payment_status IN ('paid', 'due', 'scheduled', 'overdue')
  ),
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recurring_rule_id UUID,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_recurring_rule_id_fkey;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_recurring_rule_id_fkey
  FOREIGN KEY (recurring_rule_id)
  REFERENCES recurring_expense_rules(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expenses_restaurant_date_idx
  ON expenses (restaurant_id, expense_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS expenses_category_idx
  ON expenses (restaurant_id, category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS recurring_expense_rules_restaurant_due_idx
  ON recurring_expense_rules (restaurant_id, next_due_date)
  WHERE is_active = TRUE;

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_expense_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners and managers manage expenses" ON expenses;
CREATE POLICY "Owners and managers manage expenses"
  ON expenses FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

DROP POLICY IF EXISTS "Owners and managers manage recurring expense rules" ON recurring_expense_rules;
CREATE POLICY "Owners and managers manage recurring expense rules"
  ON recurring_expense_rules FOR ALL
  USING (
    restaurant_id IN (
      SELECT restaurant_id
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT restaurant_id
      FROM user_restaurant_roles
      WHERE user_id = auth.uid()
        AND role IN ('owner', 'manager')
    )
  );

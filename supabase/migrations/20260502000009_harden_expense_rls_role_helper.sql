-- Use the existing SECURITY DEFINER helper for user_restaurant_roles ownership.
-- This avoids RLS edge cases when expense policies check staff membership.

DROP POLICY IF EXISTS "Owners and managers manage expenses" ON expenses;
CREATE POLICY "Owners and managers manage expenses"
  ON expenses FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      WHERE urr.restaurant_id = expenses.restaurant_id
        AND urr.role IN ('owner', 'manager')
        AND user_restaurant_role_row_is_mine(urr.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      WHERE urr.restaurant_id = expenses.restaurant_id
        AND urr.role IN ('owner', 'manager')
        AND user_restaurant_role_row_is_mine(urr.user_id)
    )
  );

DROP POLICY IF EXISTS "Owners and managers manage recurring expense rules" ON recurring_expense_rules;
CREATE POLICY "Owners and managers manage recurring expense rules"
  ON recurring_expense_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      WHERE urr.restaurant_id = recurring_expense_rules.restaurant_id
        AND urr.role IN ('owner', 'manager')
        AND user_restaurant_role_row_is_mine(urr.user_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM user_restaurant_roles urr
      WHERE urr.restaurant_id = recurring_expense_rules.restaurant_id
        AND urr.role IN ('owner', 'manager')
        AND user_restaurant_role_row_is_mine(urr.user_id)
    )
  );

-- Align expense RLS with the app's staff role model.
-- user_restaurant_roles.user_id stores user_profiles.id in current projects,
-- while a few older migrations compare it directly with auth.uid().
-- Support both so existing and future projects can insert expenses safely.

DROP POLICY IF EXISTS "Owners and managers manage expenses" ON expenses;
CREATE POLICY "Owners and managers manage expenses"
  ON expenses FOR ALL
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT urr.restaurant_id
      FROM user_restaurant_roles urr
      LEFT JOIN user_profiles up ON up.id = urr.user_id
      WHERE urr.role IN ('owner', 'manager')
        AND (urr.user_id = auth.uid() OR up.auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT urr.restaurant_id
      FROM user_restaurant_roles urr
      LEFT JOIN user_profiles up ON up.id = urr.user_id
      WHERE urr.role IN ('owner', 'manager')
        AND (urr.user_id = auth.uid() OR up.auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners and managers manage recurring expense rules" ON recurring_expense_rules;
CREATE POLICY "Owners and managers manage recurring expense rules"
  ON recurring_expense_rules FOR ALL
  TO authenticated
  USING (
    restaurant_id IN (
      SELECT urr.restaurant_id
      FROM user_restaurant_roles urr
      LEFT JOIN user_profiles up ON up.id = urr.user_id
      WHERE urr.role IN ('owner', 'manager')
        AND (urr.user_id = auth.uid() OR up.auth_user_id = auth.uid())
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT urr.restaurant_id
      FROM user_restaurant_roles urr
      LEFT JOIN user_profiles up ON up.id = urr.user_id
      WHERE urr.role IN ('owner', 'manager')
        AND (urr.user_id = auth.uid() OR up.auth_user_id = auth.uid())
    )
  );

-- Phase 2: RLS policies for Phase 1 tables + helper functions

-- Helper function for RLS
CREATE OR REPLACE FUNCTION get_my_restaurant_id()
RETURNS uuid AS $$
  SELECT restaurant_id FROM user_profiles WHERE auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text AS $$
  SELECT role FROM user_profiles WHERE auth_user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- RESTAURANTS policies
CREATE POLICY restaurants_select_own ON restaurants
  FOR SELECT USING (
    auth.uid() IN (
      SELECT auth_user_id FROM user_profiles
      WHERE restaurant_id = restaurants.id AND role = 'owner'
    )
  );

CREATE POLICY restaurants_select_admin ON restaurants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY restaurants_update_own ON restaurants
  FOR UPDATE USING (
    auth.uid() IN (
      SELECT auth_user_id FROM user_profiles
      WHERE restaurant_id = restaurants.id AND role = 'owner'
    )
  );

CREATE POLICY restaurants_insert ON restaurants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid() AND role = 'admin'
    )
  );

-- Note: Seed data uses service role which bypasses RLS

-- USER_PROFILES policies
CREATE POLICY user_profiles_select_own ON user_profiles
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY user_profiles_select_staff_customers ON user_profiles
  FOR SELECT USING (
    auth_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up2
      WHERE up2.auth_user_id = auth.uid()
        AND up2.restaurant_id = user_profiles.restaurant_id
        AND up2.role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY user_profiles_insert ON user_profiles
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY user_profiles_update_own ON user_profiles
  FOR UPDATE USING (auth_user_id = auth.uid());

-- TABLES policies
CREATE POLICY tables_select_staff ON "tables"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = "tables".restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY tables_insert_owner ON "tables"
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = "tables".restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY tables_update_owner ON "tables"
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = "tables".restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY tables_delete_owner ON "tables"
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = "tables".restaurant_id
        AND role = 'owner'
    )
  );

-- SHIFTS policies
CREATE POLICY shifts_select_staff ON shifts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = shifts.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY shifts_insert_owner ON shifts
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = shifts.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY shifts_update_owner ON shifts
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = shifts.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY shifts_delete_owner ON shifts
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = shifts.restaurant_id
        AND role = 'owner'
    )
  );

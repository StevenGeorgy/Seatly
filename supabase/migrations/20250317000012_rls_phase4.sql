-- Phase 4: RLS policies for menu_categories and menu_items

-- MENU_CATEGORIES policies
-- Public can read active categories
CREATE POLICY menu_categories_select_public ON menu_categories
  FOR SELECT USING (is_active = true);

-- Owners can read all (including inactive)
CREATE POLICY menu_categories_select_owner ON menu_categories
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_categories.restaurant_id
        AND role = 'owner'
    )
  );

-- Owners can insert, update, delete
CREATE POLICY menu_categories_insert_owner ON menu_categories
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_categories.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY menu_categories_update_owner ON menu_categories
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_categories.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY menu_categories_delete_owner ON menu_categories
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_categories.restaurant_id
        AND role = 'owner'
    )
  );

-- MENU_ITEMS policies
-- Public can read active items
CREATE POLICY menu_items_select_public ON menu_items
  FOR SELECT USING (is_active = true);

-- Owners can read all (including inactive)
CREATE POLICY menu_items_select_owner ON menu_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_items.restaurant_id
        AND role = 'owner'
    )
  );

-- Owners can insert, update, delete
CREATE POLICY menu_items_insert_owner ON menu_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_items.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY menu_items_update_owner ON menu_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_items.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY menu_items_delete_owner ON menu_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = menu_items.restaurant_id
        AND role = 'owner'
    )
  );

-- Phase 3: RLS policies for guests, reservations, waitlist

-- GUESTS policies
CREATE POLICY guests_select_staff ON guests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = guests.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY guests_select_own ON guests
  FOR SELECT USING (
    user_profile_id IN (
      SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
    )
  );

CREATE POLICY guests_insert_owner ON guests
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = guests.restaurant_id
        AND role = 'owner'
    )
  );

CREATE POLICY guests_update_owner ON guests
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = guests.restaurant_id
        AND role = 'owner'
    )
  );

-- RESERVATIONS policies
CREATE POLICY reservations_select_staff ON reservations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = reservations.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY reservations_select_own ON reservations
  FOR SELECT USING (
    guest_id IN (
      SELECT id FROM guests WHERE user_profile_id IN (
        SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()
      )
    )
  );

CREATE POLICY reservations_insert_staff ON reservations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = reservations.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY reservations_update_staff ON reservations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = reservations.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

-- WAITLIST policies
CREATE POLICY waitlist_select_staff ON waitlist
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = waitlist.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY waitlist_insert_staff ON waitlist
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = waitlist.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY waitlist_update_staff ON waitlist
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = waitlist.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

CREATE POLICY waitlist_delete_staff ON waitlist
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE auth_user_id = auth.uid()
        AND restaurant_id = waitlist.restaurant_id
        AND role IN ('host', 'waiter', 'owner', 'kitchen', 'admin')
    )
  );

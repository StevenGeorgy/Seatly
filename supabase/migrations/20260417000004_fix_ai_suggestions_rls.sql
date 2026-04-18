DROP POLICY IF EXISTS "Owners manage ai_suggestions" ON ai_suggestions;

CREATE POLICY "ai_suggestions_manage_owner" ON ai_suggestions FOR ALL
  USING (EXISTS (
    SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
     WHERE up.auth_user_id = auth.uid()
       AND urr.restaurant_id = ai_suggestions.restaurant_id
       AND urr.role = ANY (ARRAY['owner','manager'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1
      FROM user_restaurant_roles urr
      JOIN user_profiles up ON up.id = urr.user_id
     WHERE up.auth_user_id = auth.uid()
       AND urr.restaurant_id = ai_suggestions.restaurant_id
       AND urr.role = ANY (ARRAY['owner','manager'])
  ));

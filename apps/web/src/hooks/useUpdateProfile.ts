import { useState } from "react";
import { toast } from "sonner";

import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import type { ProfileUpdateValues } from "@/lib/validation/profile-schemas";

export function useUpdateProfile() {
  const { profile, refreshUser } = useUser();
  const [saving, setSaving] = useState(false);

  const updateProfile = async (values: ProfileUpdateValues) => {
    if (!profile?.id || !isSupabaseConfigured()) return;

    setSaving(true);
    const client = getSupabaseBrowserClient();

    // Email change goes through Supabase auth — triggers a verification email.
    if (values.email && values.email !== profile.email) {
      const { error: authErr } = await client.auth.updateUser({ email: values.email });
      if (authErr) {
        toast.error("Could not update email: " + authErr.message);
        setSaving(false);
        return;
      }
      toast.info("Verification email sent — your email will update after you confirm it.");
    }

    const { error: dbErr } = await client
      .from("user_profiles")
      .update({
        full_name: values.full_name,
        phone: values.phone || null,
        email: values.email,
        dietary_restrictions: values.dietary_restrictions,
        allergies: values.allergies,
      })
      .eq("id", profile.id);

    if (dbErr) {
      toast.error("Could not save profile: " + dbErr.message);
      setSaving(false);
      return;
    }

    await refreshUser();
    toast.success("Profile saved.");
    setSaving(false);
  };

  return { updateProfile, saving };
}

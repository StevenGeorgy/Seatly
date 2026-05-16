import { useState } from "react";
import { toast } from "sonner";

import { showErrorToast } from "@/lib/errors";
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
        showErrorToast(authErr, {
          context: "Couldn't update email",
          logTag: "[useUpdateProfile.email]",
        });
        setSaving(false);
        return;
      }
      toast.info("Verification email sent — your email will update after you confirm it.");
    }

    const updateRow: Record<string, unknown> = {
      full_name: values.full_name,
      phone: values.phone || null,
      email: values.email,
      dietary_restrictions: values.dietary_restrictions,
      allergies: values.allergies,
    };
    // avatar_url is opt-in — only include when explicitly passed (string or
    // null). Leaving it undefined means "don't touch the column."
    if (values.avatar_url !== undefined) {
      updateRow.avatar_url = values.avatar_url;
    }
    const { error: dbErr } = await client
      .from("user_profiles")
      .update(updateRow)
      .eq("id", profile.id);

    if (dbErr) {
      showErrorToast(dbErr, {
        context: "Couldn't save profile",
        logTag: "[useUpdateProfile.save]",
      });
      setSaving(false);
      return;
    }

    await refreshUser();
    toast.success("Profile saved.");
    setSaving(false);
  };

  return { updateProfile, saving };
}

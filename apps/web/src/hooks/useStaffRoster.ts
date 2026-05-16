import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { toUserFacingError } from "@/lib/errors";
import { MOCK_STAFF } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { DashboardPermissionOverrides, StaffRole } from "@/types/auth";

export type StaffMemberRow = {
  id: string;
  user_id: string;
  restaurant_id: string;
  role: string;
  is_primary: boolean;
  hourly_rate: number | null;
  employment_type: string | null;
  permission_overrides_json?: DashboardPermissionOverrides;
  created_at: string | null;
  user_profiles?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    avatar_url: string | null;
  } | null;
};

type UseStaffRosterOptions = {
  includeMock?: boolean;
};

type StaffRosterActionResult = {
  ok: boolean;
  error?: string;
};

export function useStaffRoster(options: UseStaffRosterOptions = {}) {
  const { includeMock = true } = options;
  const { selectedRestaurantId } = useRestaurantScope();
  const [members, setMembers] = useState<StaffMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchRoster = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setMembers([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data, error: qErr } = await client
      .from("user_restaurant_roles")
      .select("*, user_profiles(full_name, email, phone, avatar_url)")
      .eq("restaurant_id", selectedRestaurantId)
      .order("created_at");

    if (qErr) {
      const friendly = toUserFacingError(qErr, "Couldn't load the staff list.");
      setError(new Error(friendly.message));
      console.error("[useStaffRoster.fetch]", friendly.code, friendly.technical ?? qErr);
      setMembers([]);
    } else {
      const rows = (data ?? []) as StaffMemberRow[];
      setMembers(rows.length > 0 || !includeMock ? rows : MOCK_STAFF);
    }
    setLoading(false);
  }, [includeMock, selectedRestaurantId]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchRoster());
  }, [fetchRoster]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`staff-roster:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "user_restaurant_roles",
          filter: `restaurant_id=eq.${selectedRestaurantId}`,
        },
        () => {
          void fetchRoster();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [fetchRoster, selectedRestaurantId]);

  const updateMemberAccess = useCallback(
    async (
      memberId: string,
      role: Extract<StaffRole, "owner" | "manager" | "host">,
      permissionOverrides: DashboardPermissionOverrides,
    ): Promise<StaffRosterActionResult> => {
      if (!selectedRestaurantId || !isSupabaseConfigured()) {
        return { ok: false, error: "Select a restaurant before updating staff access." };
      }

      const client = getSupabaseBrowserClient();
      const { data, error: updateError } = await client
        .from("user_restaurant_roles")
        .update({
          role,
          permission_overrides_json: permissionOverrides,
        })
        .eq("id", memberId)
        .eq("restaurant_id", selectedRestaurantId)
        .select("id")
        .maybeSingle();

      if (updateError) {
        const friendly = toUserFacingError(updateError, "Couldn't update this staff member.");
        console.error("[useStaffRoster.updateMember]", friendly.code, friendly.technical ?? updateError);
        return { ok: false, error: friendly.message };
      }
      if (!data) return { ok: false, error: "You do not have permission to update this staff member." };

      await fetchRoster();
      return { ok: true };
    },
    [fetchRoster, selectedRestaurantId],
  );

  const removeMemberAccess = useCallback(
    async (memberId: string): Promise<StaffRosterActionResult> => {
      if (!selectedRestaurantId || !isSupabaseConfigured()) {
        return { ok: false, error: "Select a restaurant before removing staff access." };
      }

      const client = getSupabaseBrowserClient();
      const { data, error: deleteError } = await client
        .from("user_restaurant_roles")
        .delete()
        .eq("id", memberId)
        .eq("restaurant_id", selectedRestaurantId)
        .select("id")
        .maybeSingle();

      if (deleteError) {
        const friendly = toUserFacingError(deleteError, "Couldn't remove this staff member.");
        console.error("[useStaffRoster.removeMember]", friendly.code, friendly.technical ?? deleteError);
        return { ok: false, error: friendly.message };
      }
      if (!data) return { ok: false, error: "You do not have permission to remove this staff member." };

      await fetchRoster();
      return { ok: true };
    },
    [fetchRoster, selectedRestaurantId],
  );

  return {
    members,
    loading,
    error,
    refetch: fetchRoster,
    updateMemberAccess,
    removeMemberAccess,
  };
}

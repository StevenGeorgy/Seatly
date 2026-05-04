import { useCallback, useEffect, useState } from "react";

import { useUser } from "@/hooks/useUser";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { DashboardPermissionOverrides, StaffRole } from "@/types/auth";

export type MyStaffInvite = {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  role: StaffRole;
  token: string;
  expires_at: string;
  permission_overrides_json: DashboardPermissionOverrides;
};

export function useMyStaffInvites() {
  const { session } = useUser();
  const accessToken = session?.access_token;
  const [invites, setInvites] = useState<MyStaffInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!accessToken || !isSupabaseConfigured()) {
      setInvites([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/get-my-staff-invites`, {
        headers: {
          apikey: getSupabaseAnonKey(),
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await res.json().catch(() => ({}))) as {
        invites?: MyStaffInvite[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "Could not load staff invites.");
      }
      setInvites(payload.invites ?? []);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchInvites());
  }, [fetchInvites]);

  const refreshAfterAuthChange = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    await getSupabaseBrowserClient().auth.getSession();
    await fetchInvites();
  }, [fetchInvites]);

  return { invites, loading, error, refetch: fetchInvites, refreshAfterAuthChange };
}

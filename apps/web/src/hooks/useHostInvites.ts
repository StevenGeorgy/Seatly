import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { toUserFacingError } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { DashboardPermissionOverrides, StaffRole } from "@/types/auth";

export type HostInviteStatus = "pending" | "accepted" | "cancelled" | "expired";
export type HostInviteDeliveryStatus = "created" | "sent" | "setup_required" | "failed";

export type HostInviteRow = {
  id: string;
  restaurant_id: string;
  role: StaffRole;
  email: string | null;
  phone: string | null;
  token: string;
  status: HostInviteStatus;
  invited_by: string | null;
  invited_by_email: string | null;
  message_channel: "email" | "sms";
  delivery_status: HostInviteDeliveryStatus;
  delivery_error: string | null;
  permission_overrides_json: DashboardPermissionOverrides;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

type HostInviteActionResult = {
  ok: boolean;
  setupRequired?: boolean;
  error?: string;
};

async function callInviteFunction(body: Record<string, unknown>): Promise<HostInviteActionResult> {
  const client = getSupabaseBrowserClient();
  const {
    data: { session },
  } = await client.auth.getSession();

  if (!session?.access_token) {
    return { ok: false, error: "You need to sign in again." };
  }

  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/invite-staff`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    setup_required?: boolean;
  };

  return {
    ok: res.ok && !payload.setup_required,
    setupRequired: payload.setup_required,
    error: payload.error,
  };
}

export function useHostInvites() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [invites, setInvites] = useState<HostInviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchInvites = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setInvites([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();
    const { data, error: queryError } = await client
      .from("staff_invitations")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .order("created_at", { ascending: false });

    if (queryError) {
      setInvites([]);
      const friendly = toUserFacingError(queryError, "Couldn't load staff invites.");
      setError(new Error(friendly.message));
      console.error("[useHostInvites.fetch]", friendly.code, friendly.technical ?? queryError);
    } else {
      setInvites((data ?? []) as HostInviteRow[]);
    }
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchInvites());
  }, [fetchInvites]);

  useEffect(() => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`host-invites:${selectedRestaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "staff_invitations",
          filter: `restaurant_id=eq.${selectedRestaurantId}`,
        },
        () => {
          void fetchInvites();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [fetchInvites, selectedRestaurantId]);

  const sendInvite = useCallback(
    async (
      contact: string,
      role: Extract<StaffRole, "owner" | "manager" | "host">,
      permissionOverrides: DashboardPermissionOverrides,
    ) => {
      if (!selectedRestaurantId) {
        return { ok: false, error: "Select a restaurant before inviting staff." };
      }
      const result = await callInviteFunction({
        action: "create",
        restaurant_id: selectedRestaurantId,
        contact,
        role,
        permission_overrides_json: permissionOverrides,
      });
      await fetchInvites();
      return result;
    },
    [fetchInvites, selectedRestaurantId],
  );

  const resendInvite = useCallback(
    async (inviteId: string) => {
      const result = await callInviteFunction({
        action: "resend",
        invite_id: inviteId,
      });
      await fetchInvites();
      return result;
    },
    [fetchInvites],
  );

  const cancelInvite = useCallback(
    async (inviteId: string) => {
      const result = await callInviteFunction({
        action: "cancel",
        invite_id: inviteId,
      });
      await fetchInvites();
      return result;
    },
    [fetchInvites],
  );

  return {
    invites,
    loading,
    error,
    refetch: fetchInvites,
    sendInvite,
    resendInvite,
    cancelInvite,
  };
}

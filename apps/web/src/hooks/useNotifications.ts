import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

export type NotificationRow = {
  id: string;
  user_id: string;
  restaurant_id: string | null;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown> | null;
  is_read: boolean;
  sent_push: boolean;
  created_at: string;
};

const EMPTY_NOTIFICATIONS: NotificationRow[] = [];

async function fetchNotificationsForUser(userId: string): Promise<NotificationRow[]> {
  if (!isSupabaseConfigured()) return [];
  const client = getSupabaseBrowserClient();
  const { data, error: qErr } = await client
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (qErr) {
    const friendly = toUserFacingError(qErr, "Couldn't load notifications.");
    console.error("[useNotifications.fetch]", friendly.code, friendly.technical ?? qErr);
    throw new Error(friendly.message);
  }
  return (data ?? []) as NotificationRow[];
}

export function useNotifications() {
  const { profile } = useUser();
  const queryClient = useQueryClient();
  const userId = profile?.id;

  const queryKey = ["notifications", userId ?? null] as const;

  const query = useQuery({
    queryKey,
    queryFn: () => fetchNotificationsForUser(userId as string),
    enabled: Boolean(userId),
  });

  const notifications = query.data ?? EMPTY_NOTIFICATIONS;
  const loading = userId ? query.isPending : false;
  const error = (query.error as Error | null) ?? null;

  const refetch = useCallback(async () => {
    await query.refetch();
  }, [query]);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { void queryClient.invalidateQueries({ queryKey: ["notifications", userId] }); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [userId, queryClient]);

  useEffect(() => {
    if (!userId) return;
    const handleNotificationsChanged = () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
    };
    window.addEventListener("cenaiva:notifications-changed", handleNotificationsChanged);
    return () => window.removeEventListener("cenaiva:notifications-changed", handleNotificationsChanged);
  }, [queryClient, userId]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markRead = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client.from("notifications").update({ is_read: true }).eq("id", id);
    queryClient.setQueryData<NotificationRow[]>(["notifications", userId ?? null], (prev) =>
      (prev ?? []).map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
  }, [queryClient, userId]);

  return { notifications, unreadCount, loading, error, refetch, markRead };
}

import { useCallback, useEffect, useState } from "react";

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

export function useNotifications() {
  const { profile } = useUser();
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const userId = profile?.id;

  const fetchNotifications = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const { data, error: qErr } = await client
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (qErr) {
      setError(new Error(qErr.message));
      setNotifications([]);
    } else {
      setNotifications((data ?? []) as NotificationRow[]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { void fetchNotifications(); }, [fetchNotifications]);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return;

    const client = getSupabaseBrowserClient();
    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { void fetchNotifications(); },
      )
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [userId, fetchNotifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const markRead = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  }, []);

  return { notifications, unreadCount, loading, error, refetch: fetchNotifications, markRead };
}

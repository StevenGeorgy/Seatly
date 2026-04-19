import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

export function useSavedCards() {
  const { profile } = useUser();
  const [hasCard, setHasCard] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile?.id || !isSupabaseConfigured()) return;
    setLoading(true);
    const client = getSupabaseBrowserClient();
    client
      .from("saved_cards")
      .select("id", { count: "exact", head: true })
      .eq("user_profile_id", profile.id)
      .then(({ count }) => {
        setHasCard((count ?? 0) > 0);
        setLoading(false);
      });
  }, [profile?.id]);

  return { hasCard, loading };
}

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type SuggestionType = "menu_item" | "menu_item_update" | "promotion" | "event";

export type SuggestionRow = {
  id: string;
  restaurant_id: string;
  suggestion_type: SuggestionType;
  target_entity_id: string | null;
  title: string;
  summary: string | null;
  rationale: string | null;
  payload: Record<string, any>;
  applied_at: string | null;
  applied_entity_id: string | null;
  dismissed_at: string | null;
  generated_at: string;
};

export function useMenuSuggestions() {
  const { selectedRestaurantId } = useRestaurantScope();
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchSuggestions = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const client = getSupabaseBrowserClient();
    const { data } = await client
      .from("ai_suggestions")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .is("applied_at", null)
      .is("dismissed_at", null)
      .order("generated_at", { ascending: false });
    setSuggestions((data ?? []) as SuggestionRow[]);
    setLoading(false);
  }, [selectedRestaurantId]);

  useEffect(() => { void fetchSuggestions(); }, [fetchSuggestions]);

  const generate = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;
    setGenerating(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) return;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-menu-suggestions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ restaurant_id: selectedRestaurantId }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not generate suggestions.");
      } else if (Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions as SuggestionRow[]);
      }
    } finally {
      setGenerating(false);
    }
  }, [selectedRestaurantId]);

  const dismiss = useCallback(async (id: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client
      .from("ai_suggestions")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("id", id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const markApplied = useCallback(async (id: string, entityId: string) => {
    if (!isSupabaseConfigured()) return;
    const client = getSupabaseBrowserClient();
    await client
      .from("ai_suggestions")
      .update({ applied_at: new Date().toISOString(), applied_entity_id: entityId })
      .eq("id", id);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  return { suggestions, loading, generating, generate, dismiss, markApplied, refetch: fetchSuggestions };
}

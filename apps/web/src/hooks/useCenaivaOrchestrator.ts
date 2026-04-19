import { useCallback, useRef, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { AssistantResponseType, OrchestratorRequestType } from "@cenaiva/assistant";
import { AssistantResponse } from "@cenaiva/assistant";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cenaiva-orchestrate`;

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useCenaivaOrchestrator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (req: OrchestratorRequestType): Promise<AssistantResponseType | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const token = await getBearerToken();
        if (!token) {
          setError("Not authenticated");
          return null;
        }

        const res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(req),
          signal: controller.signal,
        });

        const json = await res.json() as Record<string, unknown>;

        if (!res.ok) {
          setError((json.error as string) ?? "Orchestrator error");
          return null;
        }

        // Validate with zod
        const parsed = AssistantResponse.safeParse(json);
        if (!parsed.success) {
          console.warn("[useCenaivaOrchestrator] Schema mismatch:", parsed.error.issues);
          // Return the raw data with best-effort cast if close enough
          return json as AssistantResponseType;
        }

        return parsed.data;
      } catch (err) {
        if ((err as Error).name === "AbortError") return null;
        setError(String(err));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, loading, error, cancel };
}

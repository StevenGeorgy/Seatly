import { useCallback, useRef, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { AssistantResponseType, OrchestratorRequestType } from "@cenaiva/assistant";
import { AssistantResponse } from "@cenaiva/assistant";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ENDPOINT = `${SUPABASE_URL}/functions/v1/cenaiva-orchestrate`;

/** Hard cap on a single orchestrator call. The edge function runs up to 5
 *  tool-use iterations + a final JSON completion (gpt-4o chat), so a realistic
 *  worst-case is ~30–35s. 20s was aborting healthy requests and surfacing the
 *  client-side "Sorry, I didn't catch that" fallback on every chat prompt. */
const REQUEST_TIMEOUT_MS = 45_000;

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
  // Ref mirror of `error` so callers can read the most recent failure cause
  // synchronously right after `await send(...)` — without waiting for the next
  // React render to flush the setState.
  const lastErrorRef = useRef<string | null>(null);

  const recordError = useCallback((msg: string | null) => {
    lastErrorRef.current = msg;
    setError(msg);
  }, []);

  const send = useCallback(
    async (req: OrchestratorRequestType): Promise<AssistantResponseType | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      setLoading(true);
      recordError(null);

      try {
        const token = await getBearerToken();
        if (!token) {
          recordError("not_authenticated");
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
          const msg = (json.error as string) ?? `http_${res.status}`;
          console.warn("[useCenaivaOrchestrator] Non-OK response:", res.status, msg);
          recordError(msg);
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
        if ((err as Error).name === "AbortError") {
          recordError("timeout");
          return null;
        }
        console.error("[useCenaivaOrchestrator] Request failed:", err);
        recordError(String(err));
        return null;
      } finally {
        window.clearTimeout(timeoutId);
        setLoading(false);
      }
    },
    [recordError],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, loading, error, lastErrorRef, cancel };
}

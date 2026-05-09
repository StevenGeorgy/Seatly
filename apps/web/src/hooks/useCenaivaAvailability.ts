import { useCallback } from "react";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

/**
 * Internal availability fast-path. Web port of mobile's
 * `lib/cenaiva/api/checkCenaivaAvailability.ts`.
 *
 * NOTE: this hook fronts the **orchestrator-internal** `cenaiva-availability`
 * edge function — DIFFERENT from `useAvailability.ts`, which fronts the
 * public `get_available_slots_cached` RPC. They co-exist by design.
 *
 * Request and response types are intentionally loose until the
 * `localBookingCollector` port (Step 2) lands — the collector's
 * `decision.request` shape is the source of truth. Once that ships, replace
 * the `unknown` casts here with the imported types.
 */
export type CenaivaAvailabilityRequest = Record<string, unknown>;
export type CenaivaAvailabilityResponse = Record<string, unknown>;

type AvailabilityResult = {
  data: CenaivaAvailabilityResponse | null;
  error: string | null;
};

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export function useCenaivaAvailability() {
  const check = useCallback(
    async (
      req: CenaivaAvailabilityRequest,
      opts?: { signal?: AbortSignal },
    ): Promise<AvailabilityResult> => {
      if (!isSupabaseConfigured()) return { data: null, error: "not_configured" };

      // Prefer the user JWT; fall back to anon key — the orchestrator-internal
      // endpoint accepts both (orchestrator enforces user identity itself).
      const userToken = await getBearerToken();
      const anonKey = getSupabaseAnonKey();
      const bearer = userToken ?? anonKey;
      if (!bearer) return { data: null, error: "not_authenticated" };

      try {
        const response = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/cenaiva-availability`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearer}`,
              apikey: anonKey,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(req),
            signal: opts?.signal,
          },
        );

        if (!response.ok) return { data: null, error: `http_${response.status}` };
        const json: unknown = await response.json();
        return {
          data: (json && typeof json === "object" ? (json as CenaivaAvailabilityResponse) : null),
          error: null,
        };
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return { data: null, error: "timeout" };
        }
        return { data: null, error: String(err) };
      }
    },
    [],
  );

  return { check };
}

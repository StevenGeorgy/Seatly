// invokeEdgeFunction — shared fetch helper for calling Supabase edge fns
// with the current diner/owner session token.
//
// Replaces three copy-pasted helpers that lived in `SubscriptionCard`,
// `ChangeSubscriptionCard`, and `StripeConnectVerifyPanel`. The two
// billing-card variants used `toUserFacingEdgeError` + console logging;
// the verify-panel variant used a bare `.error` field. The shared
// implementation uses the richer error mapping (which is strictly
// better — failures get mapped to user-facing messages instead of raw
// edge-fn strings) and accepts an optional `caller` tag for log
// prefixing.
//
// Behavior parity notes:
// - Returns `{ ok: false, error }` when Supabase is not configured.
// - Returns `{ ok: false, error: "You need to be signed in." }` when
//   there's no session — matches the wording used by the billing
//   cards. The verify-panel previously said "Sign in to continue."
//   This is a non-load-bearing copy unification.
// - On non-OK responses, logs via `console.error("[<caller>:<path>]",
//   ...)` when a caller tag is provided.

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { toUserFacingEdgeError } from "@/lib/errors";

export type EdgeFnResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export async function invokeEdgeFunction<T>(
  path: string,
  body: Record<string, unknown>,
  options?: { caller?: string },
): Promise<EdgeFnResult<T>> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Supabase is not configured." };
  }
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, error: "You need to be signed in." };

  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: getSupabaseAnonKey(),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const friendly = toUserFacingEdgeError(
      res,
      parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null,
    );
    if (options?.caller) {
      console.error(
        `[${options.caller}.invokeEdgeFunction:${path}]`,
        friendly.code,
        friendly.technical,
      );
    }
    return { ok: false, error: friendly.message };
  }
  return { ok: true, data: parsed as T };
}

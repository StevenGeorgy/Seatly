// get-my-profile-tags: ToS §19 data-rights endpoint. Returns the
// authenticated diner's accumulated profile tags + no-show risk score +
// lifetime value across every restaurant they've visited.
//
// Auth: Bearer JWT required (verified via _shared/auth.ts:checkAuth).
// Missing or invalid → 401.
//
// Backend: aggregates rows from the `guests` table where
// `user_profile_id = self`. A diner can have one `guests` row per
// restaurant they've visited; this fn flattens them into a single view:
//   - tags: union of every guests.tags array (deduplicated)
//   - no_show_risk_score: max across all guest rows (worst case)
//   - lifetime_value_cents: sum across all guest rows
//
// Until §6.4 auto-tagging engine ships, most diners see empty `tags` +
// zero scores. That's the expected fallback — the page handles it.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { checkAuth } from "../_shared/auth.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { enforceRateLimit, rateLimitIdentifier, RateLimitError } from "../_shared/rate-limit.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function jsonRes(body: unknown, status: number, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

interface ProfileTag {
  key: string;
  value: string | null;
  updated_at: string | null;
}

interface ProfileTagsResponse {
  tags: ProfileTag[];
  no_show_risk_score: number | null;
  lifetime_value_cents: number | null;
}

interface GuestRow {
  tags: string[] | null;
  no_show_risk_score: number | null;
  lifetime_value_score: number | null;
  updated_at: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonRes({ error: "Method not allowed" }, 405, req);
  }

  // Auth gate.
  const auth = await checkAuth(req, supabaseAdmin);
  if (!auth.ok) {
    return jsonRes(
      { error: auth.reason === "missing_token" ? "Sign in required" : "Invalid token" },
      401,
      req,
    );
  }

  // Rate limit: this page is queried on every Account → My data view.
  // 30/min per user is plenty without exposing a DoS surface.
  try {
    await enforceRateLimit(
      supabaseAdmin,
      "get-my-profile-tags",
      rateLimitIdentifier(req, auth.authUserId),
      { limit: 30, windowSeconds: 60 },
    );
  } catch (err) {
    if (err instanceof RateLimitError) {
      return jsonRes({ error: err.message }, 429, req);
    }
    throw err;
  }

  // Resolve user_profile from auth_user_id. The on_auth_user_created
  // trigger guarantees a row.
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("user_profiles")
    .select("id")
    .eq("auth_user_id", auth.authUserId)
    .maybeSingle<{ id: string }>();
  if (profileErr) return jsonRes({ error: profileErr.message }, 400, req);
  if (!profile) {
    return jsonRes({ error: "User profile not found" }, 403, req);
  }

  // Pull every `guests` row for this user — one per restaurant visited.
  // Until auto-tagging ships, these will be sparsely populated; that's
  // fine — the page handles the empty state.
  const { data: guestRows, error: guestErr } = await supabaseAdmin
    .from("guests")
    .select("tags, no_show_risk_score, lifetime_value_score, updated_at")
    .eq("user_profile_id", profile.id);
  if (guestErr) return jsonRes({ error: guestErr.message }, 400, req);

  const rows = (guestRows ?? []) as GuestRow[];

  // Flatten tags: union across restaurants, deduplicate, attach the
  // freshest updated_at as the tag's last-seen timestamp.
  const tagMap = new Map<string, string | null>(); // tag → freshest updated_at
  for (const row of rows) {
    if (!Array.isArray(row.tags)) continue;
    for (const tag of row.tags) {
      if (typeof tag !== "string" || !tag.trim()) continue;
      const existing = tagMap.get(tag);
      const candidate = row.updated_at ?? null;
      if (!existing || (candidate && candidate > existing)) {
        tagMap.set(tag, candidate);
      }
    }
  }

  const tags: ProfileTag[] = Array.from(tagMap.entries())
    .map(([key, updated_at]) => ({ key, value: null, updated_at }))
    .sort((a, b) => a.key.localeCompare(b.key));

  // no_show_risk_score: worst case across restaurants (the most
  // pessimistic signal a diner has earned anywhere).
  let noShowRiskScore: number | null = null;
  for (const row of rows) {
    if (typeof row.no_show_risk_score === "number") {
      noShowRiskScore = noShowRiskScore === null
        ? row.no_show_risk_score
        : Math.max(noShowRiskScore, row.no_show_risk_score);
    }
  }

  // lifetime_value_cents: sum across restaurants. `lifetime_value_score`
  // is stored in cents already per the mobile contract — pass through.
  let lifetimeValueCents: number | null = null;
  for (const row of rows) {
    if (typeof row.lifetime_value_score === "number") {
      lifetimeValueCents = (lifetimeValueCents ?? 0) + row.lifetime_value_score;
    }
  }

  const response: ProfileTagsResponse = {
    tags,
    no_show_risk_score: noShowRiskScore,
    lifetime_value_cents: lifetimeValueCents,
  };

  return jsonRes(response, 200, req);
});

// @ts-nocheck
// expire-reservation-holds: cron-called cleanup endpoint that expires
// abandoned reservation_holds rows past their grace window.
//
// Cron fires every 5 min (see supabase/migrations/*_pg_cron_expire_holds.sql)
// — but we ALSO expose this as an HTTP endpoint so an external scheduler
// (or a manual poke from ops) can run it.
//
// Auth: matches the existing cron pattern used by calculate-no-show-risk,
// expire-loyalty-points etc. — if CRON_SECRET env is unset, allow anything
// (dev/staging convenience). If set, x-cron-secret header must match.
//
// Body: ignored. Always POST.
//
// Returns: { expired: N }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function jsonRes(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function verifyCronSecret(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return true;
  return req.headers.get("x-cron-secret") === secret;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);

  if (!verifyCronSecret(req)) {
    return jsonRes(req, { error: "unauthorized" }, 401);
  }

  try {
    const { data, error } = await supabaseAdmin.rpc(
      "expire_reservation_holds",
      { p_grace_seconds: 120 },
    );
    if (error) {
      console.error("[expire-reservation-holds] RPC error", error);
      return jsonRes(req, { error: error.message }, 500);
    }
    const expired = typeof data === "number" ? data : Number(data) || 0;
    return jsonRes(req, { expired });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[expire-reservation-holds] uncaught", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});

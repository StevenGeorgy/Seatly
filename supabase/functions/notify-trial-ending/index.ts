// @ts-nocheck
// notify-trial-ending: cron-driven sweeper (daily ~9am UTC) that emails
// owners whose 90-day free trial ends within the next 7 days. The owner
// notifications helper enforces a 30-day idempotency window so we only ever
// send one "trial ending" email per trial cycle even though this cron runs
// every day for 7 consecutive days.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";
import { sendOwnerNotification } from "../_shared/owner-notifications.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const BATCH_LIMIT = 500;

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

interface TrialRow {
  id: string;
  name: string | null;
  trial_ends_at: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);
  if (!verifyCronSecret(req)) return jsonRes(req, { error: "unauthorized" }, 401);

  try {
    const nowIso = new Date().toISOString();
    const windowEndIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();

    const { data: rowsRaw, error: selectErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, name, trial_ends_at")
      .eq("subscription_status", "trialing")
      .gte("trial_ends_at", nowIso)
      .lte("trial_ends_at", windowEndIso)
      .is("deleted_at", null)
      .limit(BATCH_LIMIT);
    if (selectErr) {
      console.error("[notify-trial-ending] select error", selectErr);
      return jsonRes(req, { error: selectErr.message }, 500);
    }

    const rows = (rowsRaw ?? []) as TrialRow[];
    if (rows.length === 0) {
      return jsonRes(req, { ok: true, scanned: 0, sent: 0, skipped: 0, failed: 0 });
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of rows) {
      try {
        const result = await sendOwnerNotification({
          supabase: supabaseAdmin,
          restaurant_id: row.id,
          type: "trial_ending_soon",
          context: {
            trialEndDate: row.trial_ends_at,
            restaurantName: row.name ?? "your restaurant",
          },
          idempotent_within_seconds: 30 * 86400,
        });
        if (result.status === "sent") sent += 1;
        else if (result.status === "skipped") skipped += 1;
        else failed += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[notify-trial-ending] send threw restaurant=${row.id}`, msg);
        failed += 1;
      }
    }

    return jsonRes(req, { ok: true, scanned: rows.length, sent, skipped, failed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[notify-trial-ending] fatal", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});

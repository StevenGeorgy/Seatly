// @ts-nocheck
// auto-complete-stale-reservations: daily cron (0 5 * * * UTC). Sweeps
// reservations whose slot has ended well in the past (>= 1 hour after the
// expected turn-time window) where the owner never marked a terminal status.
// Flips status='completed' and fires refund-deposit-on-arrival for any row
// that still has charged deposits.
//
// Default product policy: "trust the diner." If the owner doesn't actively
// mark a no-show, the diner gets their deposit back next morning. Owner
// retains the No-show button (with explicit modal copy) to keep the
// deposit when the diner actually no-shows.
//
// Selection criteria:
//   - status IN ('pending', 'confirmed')         (terminal states skipped)
//   - reserved_at + 90 min + 1 hour < NOW()      (well past turn time)
//   - reserved_at >= POLICY_START                (deploy-date floor — old
//                                                stuck reservations from
//                                                before the new policy
//                                                stay untouched. Owners
//                                                deal with them manually.)
//
// Race guard: the UPDATE re-checks status IN ('pending','confirmed') so a
// concurrent owner click (Seated / Cancel / No-show) wins cleanly — we just
// skip the refund call for that row.
//
// Cron auth pattern mirrors purge-deleted-restaurants exactly. If
// CRON_SECRET is unset we allow the call (dev convenience).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const BATCH_LIMIT = 500;

// 90-minute default turn time + 1-hour safety buffer. Anything reserved
// more than 150 minutes ago that's still pending/confirmed is stale.
const STALE_BUFFER_MS = (90 + 60) * 60 * 1000;

// Deploy-date floor for the "trust the diner" default-refund policy.
// Reservations made before this date predate the policy and are NEVER
// auto-refunded — owners deal with them manually (Seated/No-show buttons
// still work). Bump if a clean-slate cutover is ever needed.
const POLICY_START_ISO = "2026-05-21T00:00:00.000Z";

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

interface StaleRow {
  id: string;
  restaurant_id: string;
  deposit_status: string | null;
  reserved_at: string;
  status: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);
  if (!verifyCronSecret(req)) return jsonRes(req, { error: "unauthorized" }, 401);

  try {
    const cutoffIso = new Date(Date.now() - STALE_BUFFER_MS).toISOString();
    const nowIso = new Date().toISOString();

    const { data: rowsRaw, error: selectErr } = await supabaseAdmin
      .from("reservations")
      .select("id, restaurant_id, deposit_status, reserved_at, status")
      .in("status", ["pending", "confirmed"])
      .gte("reserved_at", POLICY_START_ISO)
      .lt("reserved_at", cutoffIso)
      .order("reserved_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (selectErr) {
      console.error("[auto-complete-stale-reservations] select error", selectErr);
      return jsonRes(req, { error: selectErr.message }, 500);
    }

    const rows = (rowsRaw ?? []) as StaleRow[];
    if (rows.length === 0) {
      return jsonRes(req, { ok: true, processed: 0, refunded: 0, errors: [] });
    }

    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const refundUrl = `${supabaseUrl}/functions/v1/refund-deposit-on-arrival`;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    let processed = 0;
    let refunded = 0;
    const errors: Array<{ reservation_id: string; error: string }> = [];

    for (const row of rows) {
      // Status-guarded UPDATE: a concurrent owner click between SELECT and
      // UPDATE will land first; we get 0 rows back and skip the refund.
      const { data: updated, error: updateErr } = await supabaseAdmin
        .from("reservations")
        .update({
          status: "completed",
          completed_at: nowIso,
        })
        .eq("id", row.id)
        .in("status", ["pending", "confirmed"])
        .select("id");
      if (updateErr) {
        console.error(
          `[auto-complete-stale-reservations] update failed reservation=${row.id}`,
          updateErr,
        );
        errors.push({ reservation_id: row.id, error: `update:${updateErr.message}` });
        continue;
      }
      if (!updated || updated.length === 0) {
        // Owner won the race — nothing to do here.
        continue;
      }
      processed += 1;

      // No deposit on this booking → no refund call needed.
      if (row.deposit_status !== "charged") continue;

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        };
        // Pass the cron secret through so refund-deposit-on-arrival takes
        // the privileged path (no restaurant scope check).
        if (cronSecret) headers["x-cron-secret"] = cronSecret;

        const resp = await fetch(refundUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({
            reservation_id: row.id,
            source: "auto",
          }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          console.warn(
            `[auto-complete-stale-reservations] refund returned ${resp.status} for reservation=${row.id}: ${text}`,
          );
          errors.push({
            reservation_id: row.id,
            error: `refund_http_${resp.status}: ${text.slice(0, 200)}`,
          });
          continue;
        }
        refunded += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[auto-complete-stale-reservations] refund dispatch threw for reservation=${row.id}`,
          msg,
        );
        errors.push({ reservation_id: row.id, error: `refund_dispatch:${msg}` });
      }
    }

    return jsonRes(req, { ok: true, processed, refunded, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[auto-complete-stale-reservations] fatal", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});

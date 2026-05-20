// @ts-nocheck
// purge-deleted-restaurants: cron-driven sweeper (daily ~5am UTC) that
// anonymizes soft-deleted restaurants past their 30-day grace window.
//
// What "anonymize" means here: we do NOT hard-delete the restaurants row.
// CRA-regulated downstream rows (payments, deposit payments, orders, booking
// fees, subscription consent log) keep their FK reference, so the row must
// remain. Instead we null/tombstone PII columns and flip is_active to false.
// scheduled_purge_at is also nulled so the cron doesn't re-process the row
// on subsequent runs.
//
// Pending restaurant_booking_fees are closed (status='cancelled') because
// after anonymization there's no way to bill them — the restaurant's
// subscription is already terminated by the lifecycle pipeline.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { buildCorsHeaders } from "../_shared/cors.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const BATCH_LIMIT = 100;

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

interface DeletedRow {
  id: string;
  stripe_customer_id: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonRes(req, { error: "POST only" }, 405);
  if (!verifyCronSecret(req)) return jsonRes(req, { error: "unauthorized" }, 401);

  try {
    const nowIso = new Date().toISOString();

    const { data: rowsRaw, error: selectErr } = await supabaseAdmin
      .from("restaurants")
      .select("id, stripe_customer_id")
      .not("deleted_at", "is", null)
      .not("scheduled_purge_at", "is", null)
      .lt("scheduled_purge_at", nowIso)
      .limit(BATCH_LIMIT);
    if (selectErr) {
      console.error("[purge-deleted-restaurants] select error", selectErr);
      return jsonRes(req, { error: selectErr.message }, 500);
    }

    const rows = (rowsRaw ?? []) as DeletedRow[];
    if (rows.length === 0) {
      return jsonRes(req, {
        ok: true,
        processed: 0,
        anonymized: 0,
        booking_fees_closed: 0,
        errors: [],
      });
    }

    let processed = 0;
    let anonymized = 0;
    let bookingFeesClosed = 0;
    const errors: Array<{ restaurant_id: string; error: string }> = [];

    for (const row of rows) {
      processed += 1;

      // 1) Close out any pending booking fees so they don't sit forever.
      try {
        const { data: feesUpdated, error: feesErr } = await supabaseAdmin
          .from("restaurant_booking_fees")
          .update({
            status: "cancelled",
            cancelled_at: nowIso,
            failure_reason: "restaurant_deleted",
          })
          .eq("restaurant_id", row.id)
          .eq("status", "pending")
          .select("id");
        if (feesErr) {
          console.error(
            `[purge-deleted-restaurants] booking-fee update failed restaurant=${row.id}`,
            feesErr,
          );
          errors.push({ restaurant_id: row.id, error: `fees:${feesErr.message}` });
        } else {
          bookingFeesClosed += (feesUpdated ?? []).length;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[purge-deleted-restaurants] booking-fee update threw restaurant=${row.id}`,
          msg,
        );
        errors.push({ restaurant_id: row.id, error: `fees:${msg}` });
      }

      // 2) Anonymize the row. NOTE: postal_code / logo_url do not exist on
      // this schema as of 2026-05-20 — actual PII columns confirmed via
      // information_schema. Touch only what's actually there. `cover_image_url`
      // is the legacy mirror of cover_photo_url; null both. `website` and
      // `current_shift_briefing` and `slug` are also PII-adjacent.
      try {
        const { error: anonErr } = await supabaseAdmin
          .from("restaurants")
          .update({
            name: "Deleted Restaurant",
            email: null,
            phone: null,
            address: null,
            city: null,
            province: null,
            country: null,
            description: null,
            cover_photo_url: null,
            cover_image_url: null,
            website: null,
            current_shift_briefing: null,
            lat: null,
            lng: null,
            is_active: false,
            is_published: false,
            payment_method_attached_at: null,
            scheduled_purge_at: null,
          })
          .eq("id", row.id);
        if (anonErr) {
          console.error(
            `[purge-deleted-restaurants] anonymize failed restaurant=${row.id}`,
            anonErr,
          );
          errors.push({ restaurant_id: row.id, error: `anonymize:${anonErr.message}` });
          continue;
        }
        anonymized += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[purge-deleted-restaurants] anonymize threw restaurant=${row.id}`,
          msg,
        );
        errors.push({ restaurant_id: row.id, error: `anonymize:${msg}` });
      }
    }

    return jsonRes(req, {
      ok: true,
      processed,
      anonymized,
      booking_fees_closed: bookingFeesClosed,
      errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[purge-deleted-restaurants] fatal", msg);
    return jsonRes(req, { error: msg }, 500);
  }
});

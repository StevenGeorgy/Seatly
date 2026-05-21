// revoke-all-sessions: ToS §security endpoint. Lets a diner kill every
// active session across every device — used by the "Not me — sign out
// everywhere" affordance on the new-device banner and the Sign-in
// history page.
//
// Auth: caller MUST present a valid Supabase session JWT in the
// Authorization header. We verify via auth.getUser (ES256-aware).
//
// Side effects on success:
//   1. supabase.auth.admin.signOut(user.id, 'global') — revokes every
//      refresh token Supabase has on file for the user, across every
//      device + browser.
//   2. Acknowledges (acked_at = now()) all of the user's pending
//      new-device sign-in events so banners dismiss after the user
//      handles them on any surface.
//   3. Best-effort audit-log entry. The shared audit_log table is
//      column-shaped (table_name/operation/row_id/full_new) rather than
//      a free-form kind=… store; we insert a row that records the
//      revoke against the user_profiles row. Failures are swallowed —
//      the security action takes priority.
//
// Returns `{ ok: true }`. verify_jwt=false at the gateway because
// supabase-js currently emits ES256 tokens that the gateway can't
// validate; the in-function checkAuth IS the cryptographic check.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

import { checkAuth } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

type Payload = {
  reason?: unknown;
};

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405);

  try {
    const auth = await checkAuth(req, supabaseAdmin);
    if (!auth.ok) {
      return jsonRes({ error: "unauthorized", reason: auth.reason }, 401);
    }
    const authUserId = auth.authUserId;

    // Body is optional. We only read `reason` for audit-trail context.
    let reason: string | null = null;
    try {
      const raw = (await req.json().catch(() => null)) as Payload | null;
      if (raw && typeof raw === "object") {
        reason = asText(raw.reason);
      }
    } catch {
      // tolerate empty body
    }

    // 1. Global sign-out: revokes every refresh token for this user.
    //    Stripe-style: this is the side effect that actually closes
    //    the open sessions. Any other steps below are book-keeping.
    try {
      // The Admin API takes (user_id, scope?) — 'global' kills every
      // session, 'others' would keep the current one.
      // @ts-expect-error second arg is supported on supabase-js v2.
      const { error: signOutErr } = await supabaseAdmin.auth.admin.signOut(
        authUserId,
        "global",
      );
      if (signOutErr) {
        console.warn(
          "[revoke-all-sessions] admin.signOut error:",
          signOutErr.message,
        );
        // Surface as 500 — we couldn't actually revoke. The client
        // shouldn't claim "signed out everywhere" if Supabase refused.
        return jsonRes({ error: signOutErr.message }, 500);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[revoke-all-sessions] admin.signOut threw:", msg);
      return jsonRes({ error: msg }, 500);
    }

    // 2. Acknowledge any pending new-device alerts so the banner
    //    dismisses across all surfaces (including freshly opened
    //    tabs that will rehydrate on the next sign-in).
    try {
      const nowIso = new Date().toISOString();
      const { error: ackErr } = await supabaseAdmin
        .from("auth_sign_in_events")
        .update({ acked_at: nowIso })
        .eq("user_id", authUserId)
        .eq("is_new_device", true)
        .is("acked_at", null);
      if (ackErr) {
        console.warn(
          "[revoke-all-sessions] ack new-device events failed:",
          ackErr.message,
        );
      }
    } catch (err) {
      console.warn(
        "[revoke-all-sessions] ack new-device events threw:",
        err instanceof Error ? err.message : err,
      );
    }

    // 3. Best-effort audit log. Schema is column-shaped, not free-form,
    //    so we map this security event into the table's shape and
    //    swallow any error — the security action above is the durable
    //    one. If the table doesn't exist / column shape rejects us,
    //    we simply skip.
    try {
      await supabaseAdmin.from("audit_log").insert({
        acting_user_id: authUserId,
        acting_role: "diner",
        table_name: "auth.users",
        operation: "security.revoke_all_sessions",
        row_id: authUserId,
        full_new: { reason: reason ?? null },
      });
    } catch {
      // ignore — audit log is advisory.
    }

    return jsonRes({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonRes({ error: msg }, 500);
  }
});

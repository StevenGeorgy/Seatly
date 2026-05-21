// @ts-nocheck
// SMS opt-out helpers. The webhook fn `twilio-incoming-sms` flips
// `user_profiles.sms_opt_out` when a diner replies STOP. Every outbound
// `twilioClient.messages.create()` call site must consult
// `isPhoneOptedOut()` BEFORE sending — Twilio also blocks STOP'd numbers
// at the carrier level, but their soft-block is opt-in only and CTIA
// rules require us to honor the opt-out independently.
//
// Phone normalization here is intentionally permissive: we look up by
// BOTH the raw E.164 form (`+14165551234`) AND the 10-digit form
// (`4165551234`) because `user_profiles.phone` has historically been
// stored either way depending on the signup path (Apple OTP writes
// E.164, manual entry sometimes writes the bare digits).
//
// See CLAUDE.md §10.5 — never fall back to email when SMS opts out.
// "Skip silently" semantics: log + continue. Email is a separate
// channel that diners can opt out of via Resend's link.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export function normalizePhoneForLookup(phone: string | null | undefined): {
  e164: string | null;
  digits: string | null;
} {
  if (!phone) return { e164: null, digits: null };
  const trimmed = phone.trim();
  if (!trimmed) return { e164: null, digits: null };

  const onlyDigits = trimmed.replace(/\D/g, "");
  if (!onlyDigits) return { e164: null, digits: null };

  let digits10: string | null = null;
  let e164: string | null = null;
  if (trimmed.startsWith("+")) {
    e164 = `+${onlyDigits}`;
    // Best-effort 10-digit form for NANP numbers
    if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) {
      digits10 = onlyDigits.slice(1);
    }
  } else if (onlyDigits.length === 10) {
    e164 = `+1${onlyDigits}`;
    digits10 = onlyDigits;
  } else if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) {
    e164 = `+${onlyDigits}`;
    digits10 = onlyDigits.slice(1);
  } else {
    // Fallback: treat raw digits as the canonical form.
    e164 = `+${onlyDigits}`;
  }

  return { e164, digits: digits10 };
}

/**
 * Returns true iff a `user_profiles` row matching the phone has
 * `sms_opt_out = true`. Returns false if there is no matching row
 * (including totally unmatched phones) — non-customers haven't
 * opted out because they have no preference row.
 *
 * Best-effort: any infra error (RLS, schema drift, network) returns
 * `false` so a transient DB problem doesn't silently mute all SMS.
 */
export async function isPhoneOptedOut(
  supabase: SupabaseClient,
  phone: string | null | undefined,
): Promise<boolean> {
  if (!phone) return false;
  const { e164, digits } = normalizePhoneForLookup(phone);
  if (!e164 && !digits) return false;

  const candidates = Array.from(new Set([e164, digits].filter(Boolean))) as string[];
  if (candidates.length === 0) return false;

  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("sms_opt_out")
      .in("phone", candidates)
      .eq("sms_opt_out", true)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[sms] opt-out lookup failed:", error.message);
      return false;
    }
    return Boolean(data?.sms_opt_out);
  } catch (err) {
    console.warn("[sms] opt-out lookup threw:", err instanceof Error ? err.message : err);
    return false;
  }
}

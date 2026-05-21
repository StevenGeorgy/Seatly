import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ShieldAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type SignInEventRow = {
  id: string;
  user_agent: string | null;
  occurred_at: string;
  is_new_device: boolean | null;
  acked_at: string | null;
};

// Inline UA parser — intentionally tiny. The full ua-parser-js dep is
// ~30KB gzipped and the row only ever needs a single human-readable
// label like "Chrome on iOS". Falls back to "Unknown device" so we
// never render an empty fragment.
function parsePlatformFromUA(uaRaw: string | null | undefined): string {
  const ua = (uaRaw ?? "").toLowerCase();
  if (!ua) return "Unknown device";

  let os = "device";
  if (/iphone|ipad|ipod/.test(ua)) os = "iOS";
  else if (/android/.test(ua)) os = "Android";
  else if (/windows/.test(ua)) os = "Windows";
  else if (/mac os x|macintosh/.test(ua)) os = "macOS";
  else if (/linux/.test(ua)) os = "Linux";

  let browser = "browser";
  // Order matters: Edge/Brave/Opera all also identify as Chrome.
  if (/edg\//.test(ua)) browser = "Edge";
  else if (/firefox\//.test(ua)) browser = "Firefox";
  else if (/chrome\//.test(ua) && !/edg\//.test(ua)) browser = "Chrome";
  else if (/safari\//.test(ua) && !/chrome\//.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}

function formatEventDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Top-of-viewport security banner shown once after a new-device sign-in.
 *
 * Self-contained — fetches its own `auth_sign_in_events` row. Renders
 * `null` when:
 *   - user is not signed in
 *   - Supabase isn't configured (local dev without secrets)
 *   - there is no unacknowledged `is_new_device=true` row for the user
 *
 * Two actions:
 *   - "It's me, dismiss" → writes `acked_at = now()` to the row. The
 *     UPDATE is allowed by RLS because the diner owns the row
 *     (user_id = auth.uid()).
 *   - "Not me — sign out everywhere" → calls `revoke-all-sessions`
 *     which performs a global Supabase admin.signOut + acks all
 *     pending events server-side, then we clear the local session and
 *     bounce to /login.
 *
 * Safe to mount globally; the user-gate inside keeps it inert on
 * public pages and signed-out states.
 */
export function NewDeviceAlertBanner(): JSX.Element | null {
  const { user } = useUser();
  const navigate = useNavigate();
  const [event, setEvent] = useState<SignInEventRow | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // Fetch the most-recent unacked new-device event for this user. We
  // intentionally re-run when the user changes (sign-in / sign-out) but
  // not on a tighter cadence — the trigger that flags new devices
  // writes the row at the moment of sign-in, and the banner is meant
  // to be seen at most once per device.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user || !isSupabaseConfigured()) {
        setEvent(null);
        return;
      }
      try {
        const client = getSupabaseBrowserClient();
        const { data, error } = await client
          .from("auth_sign_in_events")
          .select("id, user_agent, occurred_at, is_new_device, acked_at")
          .eq("user_id", user.id)
          .eq("is_new_device", true)
          .is("acked_at", null)
          .order("occurred_at", { ascending: false })
          .limit(1)
          .maybeSingle<SignInEventRow>();
        if (cancelled) return;
        if (error) {
          // RLS could legitimately deny if the user_profiles trigger
          // hasn't fired yet; swallow and render null.
          setEvent(null);
          return;
        }
        setEvent(data ?? null);
      } catch {
        if (!cancelled) setEvent(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleDismiss = useCallback(async () => {
    if (!event || !user || dismissing) return;
    setDismissing(true);
    const target = event;
    // Optimistic: hide the banner immediately.
    setEvent(null);
    try {
      const client = getSupabaseBrowserClient();
      const { error } = await client
        .from("auth_sign_in_events")
        .update({ acked_at: new Date().toISOString() })
        .eq("id", target.id)
        .eq("user_id", user.id);
      if (error) throw error;
    } catch (err) {
      // Restore so the user can retry. Don't toast — this is a low-
      // stakes dismissal and a stuck banner is its own signal.
      setEvent(target);
      console.warn(
        "[NewDeviceAlertBanner] dismiss failed:",
        err instanceof Error ? err.message : err,
      );
    } finally {
      setDismissing(false);
    }
  }, [event, user, dismissing]);

  const handleRevokeAll = useCallback(async () => {
    if (!user || revoking) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase isn't configured.");
      return;
    }
    setRevoking(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Sign in expired — refresh and try again.");
        setRevoking(false);
        return;
      }
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/revoke-all-sessions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: getSupabaseAnonKey(),
          },
          body: JSON.stringify({ reason: "new_device_banner" }),
        },
      );
      let parsed: { ok?: boolean; error?: string } | null = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      if (!res.ok || !parsed?.ok) {
        toast.error(parsed?.error ?? `Couldn't sign out everywhere (${res.status}).`);
        setRevoking(false);
        return;
      }
      toast.success("Signed out everywhere. Sign in again to continue.");
      // Local cleanup. The remote refresh tokens are already toast.
      try {
        await client.auth.signOut();
      } catch {
        // Local sign-out failure shouldn't block the redirect.
      }
      setEvent(null);
      navigate("/login", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't sign out everywhere.",
      );
      setRevoking(false);
    }
  }, [user, revoking, navigate]);

  if (!user || !event) return null;

  const platform = parsePlatformFromUA(event.user_agent);
  const when = formatEventDate(event.occurred_at);

  return (
    <div
      role="alert"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[60] border-b border-amber-400/30 bg-amber-400/[0.08] backdrop-blur"
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3 text-sm text-amber-100">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" />
          <div className="min-w-0">
            <p className="font-medium text-amber-50">New sign-in detected</p>
            <p className="mt-0.5 text-xs text-amber-100/80">
              We saw a sign-in from {platform} on {when}. If this was you, you can
              dismiss this. If not, sign out everywhere.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-amber-100 hover:bg-amber-400/10 hover:text-amber-50"
            disabled={dismissing || revoking}
            onClick={() => void handleDismiss()}
          >
            <X className="mr-1 size-3.5" />
            It's me, dismiss
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={dismissing || revoking}
            onClick={() => void handleRevokeAll()}
          >
            {revoking ? "Signing out…" : "Not me — sign out everywhere"}
          </Button>
        </div>
      </div>
    </div>
  );
}

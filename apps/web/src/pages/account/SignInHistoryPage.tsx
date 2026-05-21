import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, ShieldOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useUser } from "@/hooks/useUser";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type SignInEventRow = {
  id: string;
  device_fingerprint: string | null;
  platform: string | null;
  app_version: string | null;
  user_agent: string | null;
  ip_inet: string | null;
  occurred_at: string;
  is_new_device: boolean | null;
  acked_at: string | null;
};

const LOOKBACK_DAYS = 90;
const ROW_LIMIT = 50;

// Mirrors the inline parser in NewDeviceAlertBanner — keeps device
// labels consistent between surfaces without a shared dep.
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
  if (/edg\//.test(ua)) browser = "Edge";
  else if (/firefox\//.test(ua)) browser = "Firefox";
  else if (/chrome\//.test(ua) && !/edg\//.test(ua)) browser = "Chrome";
  else if (/safari\//.test(ua) && !/chrome\//.test(ua)) browser = "Safari";

  return `${browser} on ${os}`;
}

// IPv4 → /24 mask: 192.168.1.42 → 192.168.1.x.
// IPv6 → mask the trailing 64 bits as "::x" so a casual viewer doesn't
//   pin down the device, while we still surface enough for the user to
//   recognize their own network.
function maskIp(raw: string | null | undefined): string {
  if (!raw) return "—";
  const v = raw.trim();
  if (!v) return "—";
  if (v.includes(".")) {
    const parts = v.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
    }
    return v;
  }
  if (v.includes(":")) {
    const parts = v.split(":");
    if (parts.length >= 2) {
      return `${parts.slice(0, 4).join(":")}::x`;
    }
    return v;
  }
  return v;
}

function formatRowDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function SignInHistoryPage(): JSX.Element {
  const navigate = useNavigate();
  const { user } = useUser();
  const { errorToast } = useErrorToast();

  const [rows, setRows] = useState<SignInEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!user || !isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const client = getSupabaseBrowserClient();
        const sinceIso = new Date(
          Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        ).toISOString();
        const { data, error } = await client
          .from("auth_sign_in_events")
          .select(
            "id, device_fingerprint, platform, app_version, user_agent, ip_inet, occurred_at, is_new_device, acked_at",
          )
          .eq("user_id", user.id)
          .gte("occurred_at", sinceIso)
          .order("occurred_at", { ascending: false })
          .limit(ROW_LIMIT);
        if (cancelled) return;
        if (error) throw error;
        setRows((data ?? []) as SignInEventRow[]);
      } catch (err) {
        if (!cancelled) {
          errorToast(err, {
            fallback: "Couldn't load your sign-in history.",
            logTag: "[SignInHistoryPage.load]",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/account");
  };

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
          body: JSON.stringify({ reason: "sign_in_history_page" }),
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
      try {
        await client.auth.signOut();
      } catch {
        // local sign-out failure is non-fatal
      }
      setRevokeOpen(false);
      navigate("/login", { replace: true });
    } catch (err) {
      errorToast(err, {
        fallback: "Couldn't sign out everywhere. Try again.",
        logTag: "[SignInHistoryPage.revoke]",
      });
      setRevoking(false);
    }
  }, [user, revoking, errorToast, navigate]);

  const hasRows = rows.length > 0;

  // Stable formatted rows so we don't re-parse the UA on every render.
  const display = useMemo(
    () =>
      rows.map((row) => ({
        id: row.id,
        date: formatRowDate(row.occurred_at),
        device: parsePlatformFromUA(row.user_agent),
        platform: row.platform ?? "—",
        ip: maskIp(row.ip_inet),
        isNew: Boolean(row.is_new_device),
      })),
    [rows],
  );

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <main className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8 lg:py-10">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <ArrowLeft className="size-4 text-gold" />
          Back
        </button>

        <header className="mt-6">
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <span className="h-px w-3 bg-gold/60" /> My Account
          </span>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">
            Sign-in history
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            The last {LOOKBACK_DAYS} days of sign-ins across every device.
          </p>
        </header>

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={!user || revoking}
            onClick={() => setRevokeOpen(true)}
          >
            <ShieldOff className="mr-1.5 size-3.5" />
            Sign out everywhere
          </Button>
        </div>

        <section className="mt-5 overflow-hidden rounded-2xl border border-border bg-bg-surface/70">
          {loading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : !hasRows ? (
            <div className="p-8 text-center">
              <p className="font-serif text-2xl text-white">
                No sign-in events recorded yet.
              </p>
              <p className="mt-2 text-sm text-text-muted">
                We'll list sign-in events here as they happen.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-border bg-bg-elevated/40 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Device</th>
                    <th className="px-4 py-3">Platform</th>
                    <th className="px-4 py-3">IP</th>
                    <th className="px-4 py-3">Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {display.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/40 text-text-secondary last:border-b-0"
                    >
                      <td className="px-4 py-3 text-white">{row.date}</td>
                      <td className="px-4 py-3">{row.device}</td>
                      <td className="px-4 py-3 capitalize">{row.platform}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.ip}</td>
                      <td className="px-4 py-3">
                        {row.isNew ? (
                          <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] font-medium text-amber-200">
                            New device
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="mt-4 text-xs text-text-muted">
          These events are logged for security. Email{" "}
          <a
            href="mailto:security@cenaiva.com"
            className="text-gold underline-offset-2 hover:underline"
          >
            security@cenaiva.com
          </a>{" "}
          if anything looks unfamiliar.
        </p>
      </main>

      <Dialog
        open={revokeOpen}
        onOpenChange={(next) => {
          if (!next && !revoking) setRevokeOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out everywhere?</DialogTitle>
            <DialogDescription>
              This revokes every active Cenaiva session across every device
              and browser. You'll need to sign in again on each one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setRevokeOpen(false)}
              disabled={revoking}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={revoking}
              onClick={() => void handleRevokeAll()}
            >
              {revoking ? (
                <>
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                  Signing out…
                </>
              ) : (
                "Sign out everywhere"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

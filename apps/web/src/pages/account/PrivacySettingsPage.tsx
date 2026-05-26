import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { AccountShell } from "@/components/customer/AccountShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useMyReservations } from "@/hooks/useMyReservations";
import { useUser } from "@/hooks/useUser";
import {
  isAnalyticsOptedIn,
  optInAnalytics,
  optOutAnalytics,
} from "@/lib/analytics/posthog";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type ProfileConsentRow = {
  analytics_consent: boolean | null;
  marketing_emails_consent: boolean | null;
};

const DEBOUNCE_MS = 350;

export default function PrivacySettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, profile, signOut } = useUser();
  const { errorToast } = useErrorToast();
  const { upcoming } = useMyReservations();

  const [analytics, setAnalytics] = useState<boolean>(false);
  const [marketing, setMarketing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<"analytics" | "marketing" | null>(null);

  // Delete-account state. The dialog requires the diner to type their email
  // exactly before the submit enables; prevents accidental clicks on a
  // permanent, irreversible action.
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountConfirm, setDeleteAccountConfirm] = useState("");
  const [deleteAccountSubmitting, setDeleteAccountSubmitting] = useState(false);

  const upcomingReservationCount = upcoming?.length ?? 0;
  const deleteEmailMatch =
    user?.email && deleteAccountConfirm.trim().toLowerCase() === user.email.toLowerCase();

  // Debounce timers per toggle so rapid flicks coalesce into one write.
  const analyticsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const marketingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadConsent() {
      if (!user || !isSupabaseConfigured()) {
        setLoading(false);
        return;
      }
      try {
        const client = getSupabaseBrowserClient();
        const { data } = await client
          .from("user_profiles")
          .select("analytics_consent, marketing_emails_consent")
          .eq("auth_user_id", user.id)
          .maybeSingle<ProfileConsentRow>();
        if (cancelled) return;
        setAnalytics(Boolean(data?.analytics_consent) || isAnalyticsOptedIn());
        setMarketing(Boolean(data?.marketing_emails_consent));
      } catch (err) {
        if (!cancelled) {
          errorToast(err, {
            fallback: "Couldn't load your privacy settings.",
            logTag: "[PrivacySettingsPage.load]",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadConsent();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    return () => {
      if (analyticsTimer.current) clearTimeout(analyticsTimer.current);
      if (marketingTimer.current) clearTimeout(marketingTimer.current);
    };
  }, []);

  async function persistConsent(
    key: "analytics" | "marketing",
    next: boolean,
  ): Promise<void> {
    if (!user || !isSupabaseConfigured()) return;
    setSavingKey(key);
    try {
      const client = getSupabaseBrowserClient();
      const nowIso = new Date().toISOString();
      const patch =
        key === "analytics"
          ? {
              analytics_consent: next,
              analytics_consent_at: next ? nowIso : null,
            }
          : {
              marketing_emails_consent: next,
              marketing_emails_consent_at: next ? nowIso : null,
            };
      const { error } = await client
        .from("user_profiles")
        .update(patch)
        .eq("auth_user_id", user.id);
      if (error) throw error;
      if (key === "analytics") {
        if (next) optInAnalytics();
        else optOutAnalytics();
      }
    } catch (err) {
      // Revert optimistic UI on failure.
      if (key === "analytics") setAnalytics((prev) => !prev);
      else setMarketing((prev) => !prev);
      errorToast(err, {
        fallback: "Couldn't save your preference. Try again.",
        logTag: `[PrivacySettingsPage.save.${key}]`,
      });
    } finally {
      setSavingKey(null);
    }
  }

  function onAnalyticsToggle(next: boolean) {
    setAnalytics(next);
    if (analyticsTimer.current) clearTimeout(analyticsTimer.current);
    analyticsTimer.current = setTimeout(() => {
      void persistConsent("analytics", next).then(() => {
        if (next) toast.success("Analytics enabled.");
        else toast.success("Analytics disabled.");
      });
    }, DEBOUNCE_MS);
  }

  function onMarketingToggle(next: boolean) {
    setMarketing(next);
    if (marketingTimer.current) clearTimeout(marketingTimer.current);
    marketingTimer.current = setTimeout(() => {
      void persistConsent("marketing", next).then(() => {
        if (next) toast.success("Marketing emails enabled.");
        else toast.success("Marketing emails disabled.");
      });
    }, DEBOUNCE_MS);
  }

  const handleDeleteAccount = async () => {
    if (!user || !deleteEmailMatch || deleteAccountSubmitting) return;
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setDeleteAccountSubmitting(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Sign in expired — please refresh and try again.");
        setDeleteAccountSubmitting(false);
        return;
      }
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: getSupabaseAnonKey(),
        },
        body: JSON.stringify({ email_confirmation: deleteAccountConfirm.trim() }),
      });
      let parsed:
        | {
            ok?: boolean;
            error?: string;
            blockers?: { owns_restaurants?: boolean };
            cancelled_reservation_ids?: string[];
            refund_total_cents?: number;
          }
        | null = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      if (!res.ok || !parsed?.ok) {
        const msg = parsed?.error ?? `Request failed (${res.status})`;
        toast.error(msg);
        setDeleteAccountSubmitting(false);
        return;
      }
      const refundDollars = (parsed.refund_total_cents ?? 0) / 100;
      const cancelledCount = parsed.cancelled_reservation_ids?.length ?? 0;
      const refundLine = refundDollars > 0
        ? ` CA$${refundDollars.toFixed(2)} refunded across ${cancelledCount} reservation${cancelledCount === 1 ? "" : "s"}.`
        : "";
      toast.success(`Your account has been deleted.${refundLine}`);
      setDeleteAccountOpen(false);
      await signOut();
      navigate("/");
    } catch (err) {
      errorToast(err, {
        fallback: "Couldn't delete your account. Try again or contact support.",
        logTag: "[PrivacySettingsPage.deleteAccount]",
      });
      setDeleteAccountSubmitting(false);
    }
  };

  return (
    <AccountShell activeSection="preferences">
      <header>
          <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <span className="h-px w-3 bg-gold/60" /> My Account
          </span>
          <h1 className="mt-2 font-serif text-5xl leading-none text-white">Privacy</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Control how Cenaiva uses your data. Changes apply immediately.
          </p>
        </header>

        {loading && !profile ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading your preferences…
          </div>
        ) : (
          <section className="mt-6 space-y-4">
            <SettingRow
              title="Product analytics"
              description="Anonymized usage signals (PostHog) help us improve the app. We never sell this data."
              checked={analytics}
              saving={savingKey === "analytics"}
              onChange={onAnalyticsToggle}
            />
            <SettingRow
              title="Marketing emails"
              description="Occasional emails about deals, new restaurants, and product updates."
              checked={marketing}
              saving={savingKey === "marketing"}
              onChange={onMarketingToggle}
            />
            <div className="rounded-2xl border border-border bg-bg-surface p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-serif text-lg text-white">
                    Restaurant marketing communications
                  </p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Manage per-restaurant in Notifications preferences.
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/account/notifications-preferences">Manage</Link>
                </Button>
              </div>
            </div>

            <div className="mt-2 rounded-2xl border border-destructive/30 bg-destructive/[0.04] p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="font-serif text-lg text-white">Danger zone</p>
                  <p className="mt-1 text-xs text-text-secondary">
                    Deleting your account is permanent. Any upcoming reservations will be
                    cancelled and their deposits/pre-orders refunded to your card. Your saved
                    cards will be removed. You'll need to sign up again to use Cenaiva.
                  </p>
                  {upcomingReservationCount > 0 && (
                    <p className="mt-2 text-xs text-text-muted">
                      You currently have {upcomingReservationCount} upcoming
                      reservation{upcomingReservationCount === 1 ? "" : "s"} that will be
                      cancelled.
                    </p>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => {
                      setDeleteAccountConfirm("");
                      setDeleteAccountOpen(true);
                    }}
                  >
                    <Trash2 className="mr-1.5 size-3.5" /> Delete my account…
                  </Button>
                </div>
              </div>
            </div>

            <Dialog
              open={deleteAccountOpen}
              onOpenChange={(next) => {
                if (!next && !deleteAccountSubmitting) setDeleteAccountOpen(false);
              }}
            >
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Delete your account?</DialogTitle>
                  <DialogDescription>
                    This action is permanent. Any upcoming reservations will be cancelled and
                    their deposits/pre-orders refunded. We'll detach your saved cards from
                    Stripe and remove your profile.
                  </DialogDescription>
                </DialogHeader>
                {upcomingReservationCount > 0 && (
                  <div className="rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
                    {upcomingReservationCount} upcoming
                    reservation{upcomingReservationCount === 1 ? "" : "s"} will be cancelled
                    and any eligible refunds processed.
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="delete-account-confirm">
                    Type <span className="font-mono text-text-primary">{user?.email ?? "your email"}</span> to confirm
                  </Label>
                  <Input
                    id="delete-account-confirm"
                    type="email"
                    autoComplete="off"
                    value={deleteAccountConfirm}
                    onChange={(event) => setDeleteAccountConfirm(event.target.value)}
                    placeholder={user?.email ?? "you@example.com"}
                    disabled={deleteAccountSubmitting}
                  />
                </div>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setDeleteAccountOpen(false)}
                    disabled={deleteAccountSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={!deleteEmailMatch || deleteAccountSubmitting}
                    onClick={() => void handleDeleteAccount()}
                  >
                    {deleteAccountSubmitting ? (
                      <>
                        <Loader2 className="mr-1.5 size-4 animate-spin" /> Deleting…
                      </>
                    ) : (
                      "Delete my account"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </section>
        )}
    </AccountShell>
  );
}

function SettingRow({
  title,
  description,
  checked,
  saving,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  saving: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-bg-surface p-5">
      <div className="min-w-0">
        <p className="font-serif text-lg text-white">{title}</p>
        <p className="mt-1 text-xs text-text-secondary">{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {saving && <Loader2 className="size-4 animate-spin text-text-muted" />}
        <Switch checked={checked} onCheckedChange={(next) => onChange(Boolean(next))} />
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUser } from "@/hooks/useUser";
import {
  isAnalyticsOptedIn,
  optInAnalytics,
  optOutAnalytics,
} from "@/lib/analytics/posthog";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

type ProfileConsentRow = {
  analytics_consent: boolean | null;
  marketing_emails_consent: boolean | null;
};

const DEBOUNCE_MS = 350;

export default function PrivacySettingsPage(): JSX.Element {
  const navigate = useNavigate();
  const { user, profile } = useUser();
  const { errorToast } = useErrorToast();

  const [analytics, setAnalytics] = useState<boolean>(false);
  const [marketing, setMarketing] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [savingKey, setSavingKey] = useState<"analytics" | "marketing" | null>(null);

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
    // profile object identity changes when the auth-context refreshes; we only
    // need to refetch when the user actually changes.
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

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/account");
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <main className="mx-auto w-full max-w-3xl px-5 py-6 sm:px-8 lg:py-10">
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
          </section>
        )}
      </main>
    </div>
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

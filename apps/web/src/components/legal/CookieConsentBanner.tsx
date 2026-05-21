import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useUser } from "@/hooks/useUser";
import { optInAnalytics, optOutAnalytics } from "@/lib/analytics/posthog";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

const STORAGE_KEY = "cenaiva-cookie-consent-v1";

export type CookieConsent = {
  essential: true;
  analytics: boolean;
  marketing: boolean;
  decidedAt: string;
};

type ConsentEventDetail = CookieConsent | null;

const CONSENT_EVENT = "cenaiva:cookie-consent-changed";

function readConsent(): CookieConsent | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "decidedAt" in parsed &&
      "analytics" in parsed &&
      "marketing" in parsed
    ) {
      const p = parsed as Record<string, unknown>;
      return {
        essential: true,
        analytics: Boolean(p.analytics),
        marketing: Boolean(p.marketing),
        decidedAt: String(p.decidedAt ?? new Date().toISOString()),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeConsent(next: CookieConsent): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(
      new CustomEvent<ConsentEventDetail>(CONSENT_EVENT, { detail: next }),
    );
  } catch {
    // ignore quota / disabled storage
  }
}

/**
 * Hook for other components to read the current consent state. Subscribes to
 * the `cenaiva:cookie-consent-changed` custom event so multiple banners /
 * settings panels stay in sync within one tab; the native `storage` event
 * covers cross-tab sync.
 */
export function useCookieConsent(): CookieConsent | null {
  const [consent, setConsent] = useState<CookieConsent | null>(() => readConsent());

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const detail = (ev as CustomEvent<ConsentEventDetail>).detail;
      if (detail) setConsent(detail);
      else setConsent(readConsent());
    };
    const onStorage = (ev: StorageEvent) => {
      if (ev.key === STORAGE_KEY) setConsent(readConsent());
    };
    window.addEventListener(CONSENT_EVENT, onChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CONSENT_EVENT, onChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return consent;
}

async function syncConsentToProfile(
  authUserId: string | undefined,
  next: CookieConsent,
): Promise<void> {
  if (!authUserId || !isSupabaseConfigured()) return;
  try {
    const client = getSupabaseBrowserClient();
    const nowIso = next.decidedAt;
    await client
      .from("user_profiles")
      .update({
        analytics_consent: next.analytics,
        analytics_consent_at: next.analytics ? nowIso : null,
        marketing_emails_consent: next.marketing,
        marketing_emails_consent_at: next.marketing ? nowIso : null,
      })
      .eq("auth_user_id", authUserId);
  } catch {
    // Best-effort: localStorage is the source of truth for the banner; the DB
    // write is for cross-device persistence and is retried on next visit.
  }
}

export function CookieConsentBanner(): JSX.Element | null {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [analyticsToggle, setAnalyticsToggle] = useState(false);
  const [marketingToggle, setMarketingToggle] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    if (!existing) setOpen(true);
  }, []);

  const persist = useCallback(
    (next: CookieConsent) => {
      writeConsent(next);
      if (next.analytics) optInAnalytics();
      else optOutAnalytics();
      void syncConsentToProfile(user?.id, next);
      setOpen(false);
      setCustomizeOpen(false);
    },
    [user?.id],
  );

  const handleAcceptAll = () => {
    persist({
      essential: true,
      analytics: true,
      marketing: true,
      decidedAt: new Date().toISOString(),
    });
  };

  const handleEssentialOnly = () => {
    persist({
      essential: true,
      analytics: false,
      marketing: false,
      decidedAt: new Date().toISOString(),
    });
  };

  const handleSavePreferences = () => {
    persist({
      essential: true,
      analytics: analyticsToggle,
      marketing: marketingToggle,
      decidedAt: new Date().toISOString(),
    });
  };

  if (!open && !customizeOpen) return null;

  return (
    <>
      {open && (
        <div
          role="dialog"
          aria-label="Cookie preferences"
          className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg-surface/95 backdrop-blur"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-text-primary">
              We use cookies for booking, security, and optional analytics. Read
              our{" "}
              <Link to="/privacy" className="font-medium text-gold underline-offset-2 hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAnalyticsToggle(false);
                  setMarketingToggle(false);
                  setCustomizeOpen(true);
                  setOpen(false);
                }}
              >
                Customize
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handleEssentialOnly}>
                Essential only
              </Button>
              <Button type="button" size="sm" onClick={handleAcceptAll}>
                Accept all
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog
        open={customizeOpen}
        onOpenChange={(next) => {
          if (!next) {
            setCustomizeOpen(false);
            // Re-show banner if user closed without saving and there is still
            // no persisted decision.
            if (!readConsent()) setOpen(true);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cookie preferences</DialogTitle>
            <DialogDescription>
              Choose which cookies Cenaiva can set. Essential cookies are
              required to book and keep you signed in.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <PreferenceRow
              label="Essential"
              description="Required for booking, sign-in, and security. Always on."
              checked
              disabled
              onChange={() => undefined}
            />
            <PreferenceRow
              label="Analytics"
              description="Helps us understand which features get used so we can improve them."
              checked={analyticsToggle}
              onChange={setAnalyticsToggle}
            />
            <PreferenceRow
              label="Marketing"
              description="Allows us to email you about deals and new features. You can opt out anytime."
              checked={marketingToggle}
              onChange={setMarketingToggle}
            />
          </div>

          <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCustomizeOpen(false);
                if (!readConsent()) setOpen(true);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={handleSavePreferences}>
              Save preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreferenceRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-bg-elevated/40 p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="mt-1 text-xs text-text-secondary">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(Boolean(next))}
      />
    </div>
  );
}

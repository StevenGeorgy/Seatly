// StripeConnectVerifyPanel — dashboard surface for owners to complete
// Stripe Connect identity verification AFTER their restaurant is
// published. Mirrors the Embedded onboarding flow used in
// onboarding/Step8PaymentSetup.tsx but lives on the dashboard so
// published restaurants can resolve `payouts_enabled = false`
// without re-entering the wizard.
//
// Per Stripe best practices: uses Account Sessions + embedded
// `account_onboarding` component. The same edge functions
// (`create-stripe-account`, `create-account-session`) power both
// surfaces.

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  loadConnectAndInitialize,
  type StripeConnectInstance,
} from "@stripe/connect-js";
import {
  ConnectAccountManagement,
  ConnectAccountOnboarding,
  ConnectComponentsProvider,
  ConnectNotificationBanner,
} from "@stripe/react-connect-js";

import { CENAIVA_CONNECT_APPEARANCE } from "@/lib/stripe/connectAppearance";
import { invokeEdgeFunction as sharedInvokeEdgeFunction } from "@/lib/supabase/edge-fn";

interface StripeConnectVerifyPanelProps {
  restaurantId: string;
  /** Called when Stripe's embedded UI signals the user closed/finished. */
  onExit?: () => void;
  /** When true, mounts the first-time onboarding component instead of
   *  the management surface. Used by the "Connect Stripe to start
   *  receiving payouts" recovery flow when an owner deleted /
   *  disconnected their Stripe account. */
  onboardingMode?: boolean;
}

function invokeEdgeFn<T>(
  path: string,
  body: Record<string, unknown>,
) {
  return sharedInvokeEdgeFunction<T>(path, body, {
    caller: "billing.StripeConnectVerifyPanel",
  });
}

export function StripeConnectVerifyPanel({
  restaurantId,
  onExit,
  onboardingMode = false,
}: StripeConnectVerifyPanelProps) {
  const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as
    | string
    | undefined;
  const [connectInstance, setConnectInstance] =
    useState<StripeConnectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publishableKey) {
      setError("Stripe publishable key is missing. Contact support.");
      return;
    }
    let cancelled = false;
    setError(null);

    const fetchClientSecret = async (): Promise<string> => {
      const acct = await invokeEdgeFn<{ account_id: string }>(
        "create-stripe-account",
        { restaurant_id: restaurantId },
      );
      if (!acct.ok) throw new Error(acct.error);
      // "management" mode enables the AccountManagement + NotificationBanner
      // components, which is what surfaces "Update info" actions when Stripe
      // has flagged verification errors (e.g. unverifiable address). The
      // wizard's first-time onboarding uses the default "onboarding" mode.
      const session = await invokeEdgeFn<{ client_secret: string }>(
        "create-account-session",
        {
          restaurant_id: restaurantId,
          mode: onboardingMode ? "onboarding" : "management",
        },
      );
      if (!session.ok) throw new Error(session.error);
      if (!session.data?.client_secret) {
        throw new Error("Stripe didn't return a client secret. Try again.");
      }
      return session.data.client_secret;
    };

    void (async () => {
      try {
        const instance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret,
          appearance: CENAIVA_CONNECT_APPEARANCE,
        });
        if (cancelled) return;
        setConnectInstance(instance);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Unknown error.";
        setError(msg);
        console.error("[StripeConnectVerifyPanel.init]", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [publishableKey, restaurantId, onboardingMode]);

  if (error) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
        <p className="font-semibold text-warning">Couldn't load Stripe.</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }
  if (!connectInstance) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg-surface p-6 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" /> Loading Stripe verification…
      </div>
    );
  }

  return (
    <ConnectComponentsProvider connectInstance={connectInstance}>
      <div className="flex flex-col gap-3">
        {onboardingMode ? (
          /* First-time / reconnect flow: shows the full Stripe Embedded
             Connect onboarding form. Used by the "owner deleted/disconnected
             their Stripe account" recovery path on the dashboard. */
          <ConnectAccountOnboarding onExit={() => onExit?.()} />
        ) : (
          <>
            {/* Surfaces actionable error banners (e.g. "Address couldn't be
                verified — Update info"). Clicking the banner opens the relevant
                Stripe update form inside the AccountManagement component below. */}
            <ConnectNotificationBanner />
            {/* Full account settings + verification flow for ongoing management. */}
            <ConnectAccountManagement />
          </>
        )}
      </div>
    </ConnectComponentsProvider>
  );
}

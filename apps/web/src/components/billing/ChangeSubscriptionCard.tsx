// Shared "replace the card on file" billing component.
//
// Mirrors `SubscriptionCard` but uses a fresh SetupIntent against the
// same restaurant customer and calls `update-subscription-payment-
// method` instead of `save-subscription-payment-method` /
// `create-subscription`. Lets owners swap cards without leaving
// cenaiva.com (the Stripe Billing Portal remains available from the
// dashboard for "see invoices" + "cancel" flows we deliberately don't
// rebuild).
//
// Used by:
// - The onboarding wizard Step 8, in State B (card on file, trial
//   not yet started) and State C (subscription active).
// - The Settings page subscription section.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import type { Stripe as StripeJs } from "@stripe/stripe-js";

import { Button } from "@/components/ui/button";
import { toUserFacingError } from "@/lib/errors";
import { invokeEdgeFunction as sharedInvokeEdgeFunction } from "@/lib/supabase/edge-fn";
import { recoverFromSetupIntentUnexpectedState } from "@/lib/stripe/setupIntentRecovery";

function invokeEdgeFunction<TResult>(
  path: string,
  body: Record<string, unknown>,
) {
  return sharedInvokeEdgeFunction<TResult>(path, body, {
    caller: "billing.ChangeSubscriptionCard",
  });
}

function ChangeSubscriptionCardInner({
  restaurantId,
  onSuccess,
  onCancel,
}: {
  restaurantId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;
      setSubmitting(true);
      setError(null);
      try {
        const { error: submitError } = await elements.submit();
        if (submitError) {
          const friendly = toUserFacingError(
            submitError,
            "Please check your card details.",
          );
          setError(friendly.message);
          console.error(
            "[billing.ChangeSubscriptionCard.submit]",
            friendly.code,
            friendly.technical ?? submitError,
          );
          return;
        }
        const { setupIntent, error: confirmError } = await stripe.confirmSetup({
          elements,
          redirect: "if_required",
        });
        const recovered = confirmError
          ? recoverFromSetupIntentUnexpectedState(confirmError)
          : { recovered: false as const, reason: "no_error" };
        if (confirmError && !recovered.recovered) {
          const friendly = toUserFacingError(
            confirmError,
            "Couldn't confirm your card.",
          );
          setError(friendly.message);
          console.error(
            "[billing.ChangeSubscriptionCard.confirm]",
            friendly.code,
            friendly.technical ?? confirmError,
          );
          return;
        }
        const paymentMethodId =
          typeof setupIntent?.payment_method === "string"
            ? setupIntent.payment_method
            : recovered.recovered
              ? recovered.paymentMethodId
              : null;
        if (!paymentMethodId) {
          setError("Stripe didn't return a payment method. Try again.");
          return;
        }
        // `payment_method_attached_at` is NOT reset on swap — the
        // first-attach timestamp wins for the 90-day cleanup clock.
        const swapRes = await invokeEdgeFunction<{
          ok: true;
          default_payment_method: string;
          subscription_id: string | null;
        }>("update-subscription-payment-method", {
          restaurant_id: restaurantId,
          payment_method_id: paymentMethodId,
        });
        if (!swapRes.ok) {
          setError(swapRes.error);
          return;
        }
        onSuccess();
      } finally {
        setSubmitting(false);
      }
    },
    [stripe, elements, restaurantId, onSuccess],
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card", "apple_pay", "google_pay"],
          // Apple Pay & Google Pay enabled. Link disabled to avoid the
          // cross-merchant Link signup banner.
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
          // Collect postal code in addition to country for Stripe AVS.
          // Mirrors SubscriptionCard so first-card-save and change-card
          // flows collect the same fraud signal.
          fields: {
            billingDetails: {
              address: {
                country: "auto",
                postalCode: "auto",
                line1: "never",
                line2: "never",
                city: "never",
                state: "never",
              },
            },
          },
        }}
      />
      {error ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={!stripe || !elements || submitting}>
          {submitting ? "Updating…" : "Save new card"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={submitting}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function ChangeSubscriptionCard({
  restaurantId,
  stripePromiseRef,
  onSuccess,
  onCancel,
}: {
  restaurantId: string;
  stripePromiseRef: Promise<StripeJs | null>;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void (async () => {
      const res = await invokeEdgeFunction<{ client_secret: string | null }>(
        "stripe-setup-intent",
        { restaurant_id: restaurantId },
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.data.client_secret) {
        setError("Stripe is not configured on the server.");
        return;
      }
      setClientSecret(res.data.client_secret);
    })();
  }, [restaurantId]);

  if (error) {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm text-text-secondary">
        <p className="font-semibold text-warning">Couldn't load card form.</p>
        <p className="mt-1">{error}</p>
        <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
          Close
        </Button>
      </div>
    );
  }
  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg-surface p-6 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" /> Preparing card form…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-bg-surface p-5">
      <p className="mb-4 text-sm font-semibold text-white">Replace your card</p>
      <Elements
        stripe={stripePromiseRef}
        options={{
          clientSecret,
          appearance: {
            theme: "night",
            variables: {
              colorPrimary: "#D4AF37",
              colorBackground: "#0A0A0A",
              colorText: "#FFFFFF",
              colorDanger: "#EF4444",
              fontFamily: "system-ui, -apple-system, sans-serif",
              borderRadius: "10px",
              spacingUnit: "4px",
            },
          },
        }}
      >
        <ChangeSubscriptionCardInner
          restaurantId={restaurantId}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      </Elements>
    </div>
  );
}

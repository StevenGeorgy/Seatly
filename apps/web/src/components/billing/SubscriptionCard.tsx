// Shared subscription-card billing component.
//
// Wraps Stripe Elements + a SetupIntent fetch + the inner submit form
// for the Cenaiva owner subscription card. Originally lived inline in
// `Step8PaymentSetup.tsx`; lifted here so the Settings page (and any
// future surface) can reuse the same flow.
//
// As of the 2026-05-20 lifecycle rework, the submit handler calls
// `save-subscription-payment-method` rather than `create-subscription`
// — saving a card no longer starts the 90-day trial. The trial starts
// only when the owner publishes (or, for the Settings page, when they
// explicitly opt in there). The `onPaymentMethodSaved` callback fires
// after a successful save so the parent can refresh restaurant state.

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

import { SAVE_CARD_DISCLOSURE } from "./disclosures";

function invokeEdgeFunction<TResult>(
  path: string,
  body: Record<string, unknown>,
) {
  return sharedInvokeEdgeFunction<TResult>(path, body, {
    caller: "billing.SubscriptionCard",
  });
}

function SubscriptionCardInner({
  restaurantId,
  referralCode,
  onPaymentMethodSaved,
}: {
  restaurantId: string;
  referralCode?: string | null;
  onPaymentMethodSaved: (info: { payment_method_id: string }) => void;
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
            "[billing.SubscriptionCard.submit]",
            friendly.code,
            friendly.technical ?? submitError,
          );
          return;
        }
        const { setupIntent, error: confirmError } = await stripe.confirmSetup({
          elements,
          redirect: "if_required",
        });
        // Recovery path: if the SetupIntent was already confirmed in a
        // prior submit attempt (e.g., the follow-up edge fn failed and
        // the user clicked Submit again without refreshing), Stripe
        // returns setup_intent_unexpected_state. Reuse the prior
        // SetupIntent's PaymentMethod and skip straight to the save.
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
            "[billing.SubscriptionCard.confirm]",
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
        // Save the card on the restaurant's Stripe customer without
        // starting a subscription. The trial begins at publish time.
        // `referral_code` is forwarded if present; the edge fn may
        // ignore it today and consume it in a later phase — this is a
        // forward-compatible payload.
        const saveRes = await invokeEdgeFunction<{
          ok: true;
          payment_method_id: string;
        }>("save-subscription-payment-method", {
          restaurant_id: restaurantId,
          payment_method_id: paymentMethodId,
          disclosure_text: SAVE_CARD_DISCLOSURE,
          ...(referralCode ? { referral_code: referralCode } : {}),
        });
        if (!saveRes.ok) {
          setError(saveRes.error);
          return;
        }
        onPaymentMethodSaved({ payment_method_id: paymentMethodId });
      } finally {
        setSubmitting(false);
      }
    },
    [stripe, elements, restaurantId, referralCode, onPaymentMethodSaved],
  );

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      {/* Owners paying their monthly subscription won't benefit from
          Stripe Link (they pay once and forget). paymentMethodOrder=
          ['card'] hides the "Secure, fast checkout with Link" badge
          and the Apple/Google Pay tabs — clean card-only form.
          Diner-side payments (StripePaymentForm.tsx) keep Link +
          wallets enabled for future returning-customer conversion
          uplift. */}
      <PaymentElement
        options={{
          layout: "tabs",
          paymentMethodOrder: ["card", "apple_pay", "google_pay"],
          // Apple Pay & Google Pay enabled for the owner card-on-file
          // collection. Link disabled to avoid the "Secure, fast checkout
          // with Link" cross-merchant signup banner.
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
        }}
      />
      {error ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </div>
      ) : null}
      <p className="text-xs text-text-muted">{SAVE_CARD_DISCLOSURE}</p>
      <Button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-fit"
      >
        {submitting ? "Saving…" : "Save card"}
      </Button>
    </form>
  );
}

export function SubscriptionCard({
  restaurantId,
  stripePromiseRef,
  referralCode,
  onPaymentMethodSaved,
}: {
  restaurantId: string;
  stripePromiseRef: Promise<StripeJs | null>;
  referralCode?: string | null;
  onPaymentMethodSaved: (info: { payment_method_id: string }) => void;
}) {
  // SetupIntent client_secret tied to the *restaurant's* Stripe
  // customer. stripe-setup-intent accepts restaurant_id to target the
  // restaurant customer — Stripe blocks moving a PaymentMethod
  // between customers, so the SetupIntent must be created on the same
  // customer that will eventually be billed.
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
      </div>
    );
  }
  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-border bg-bg-surface p-6 text-sm text-text-muted">
        <Loader2 className="size-4 animate-spin" /> Preparing checkout…
      </div>
    );
  }

  return (
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
      <SubscriptionCardInner
        restaurantId={restaurantId}
        referralCode={referralCode}
        onPaymentMethodSaved={onPaymentMethodSaved}
      />
    </Elements>
  );
}

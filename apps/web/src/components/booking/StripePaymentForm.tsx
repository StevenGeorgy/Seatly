import { useCallback, useMemo, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getSupabaseAnonKey, getSupabaseProjectUrl } from "@/lib/supabase/client";

const STRIPE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string | undefined) ??
  "";

let cachedStripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise(): Promise<StripeJs | null> | null {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  if (!cachedStripePromise) {
    cachedStripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }
  return cachedStripePromise;
}

type StripePaymentFormProps = {
  restaurantId: string;
  amountCents: number;
  /**
   * Fired when the card has been successfully charged. The parent is then
   * responsible for creating the reservation server-side. The frontend
   * passes the resulting reservation_id (and order_id, if any) back to
   * Stripe via paymentIntents.update so the webhook can later sync state.
   */
  onPaid: (paymentIntentId: string) => Promise<void> | void;
  onError?: (message: string) => void;
  payButtonLabel?: string;
  /**
   * Forms the parent's submit button can target via <button form={formId}>.
   */
  formId?: string;
  hideInternalSubmit?: boolean;
};

/**
 * Diner-side Stripe checkout form using **deferred PaymentIntent mode**:
 * Elements mounts WITHOUT a clientSecret. On submit, we (1) call
 * `elements.submit()` to validate, (2) fetch a freshly-created client_secret
 * from `create-public-payment-intent`, (3) call `stripe.confirmPayment` with
 * that secret. On success, fire `onPaid` so the parent can create the
 * reservation. The reservation only exists if the card actually cleared.
 */
export function StripePaymentForm(props: StripePaymentFormProps) {
  const stripePromise = useMemo(() => getStripePromise(), []);

  if (!stripePromise) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        Stripe is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY in the web app env.
      </div>
    );
  }
  if (props.amountCents < 50) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        Total is below Stripe's 50¢ minimum charge.
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: "payment",
        amount: props.amountCents,
        currency: "cad",
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "#D4AF37",
            colorBackground: "#0A0A0A",
            colorText: "#FFFFFF",
            borderRadius: "8px",
          },
        },
      }}
    >
      <PaymentFormInner
        restaurantId={props.restaurantId}
        amountCents={props.amountCents}
        onPaid={props.onPaid}
        onError={props.onError}
        payButtonLabel={props.payButtonLabel ?? "Pay & confirm"}
        formId={props.formId}
        hideInternalSubmit={props.hideInternalSubmit}
      />
    </Elements>
  );
}

function PaymentFormInner({
  restaurantId,
  amountCents,
  onPaid,
  onError,
  payButtonLabel,
  formId,
  hideInternalSubmit,
}: {
  restaurantId: string;
  amountCents: number;
  onPaid: (paymentIntentId: string) => Promise<void> | void;
  onError?: (message: string) => void;
  payButtonLabel: string;
  formId?: string;
  hideInternalSubmit?: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;
      setSubmitting(true);
      setErrorMsg(null);
      try {
        // 1. Validate card fields locally before hitting the server.
        const { error: submitError } = await elements.submit();
        if (submitError) {
          const msg = submitError.message ?? "Please check your card details.";
          setErrorMsg(msg);
          onError?.(msg);
          return;
        }

        // 2. Create the PaymentIntent JIT (the reservation doesn't exist yet —
        //    that's the whole point of deferred mode here).
        const intentRes = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/create-public-payment-intent`,
          {
            method: "POST",
            headers: {
              apikey: getSupabaseAnonKey(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              restaurant_id: restaurantId,
              amount_cents: amountCents,
            }),
          },
        );
        const intentBody = (await intentRes.json().catch(() => ({}))) as {
          client_secret?: string;
          payment_intent_id?: string;
          error?: string;
        };
        if (!intentRes.ok || !intentBody.client_secret) {
          const msg = intentBody.error ?? "Couldn't start payment.";
          setErrorMsg(msg);
          onError?.(msg);
          return;
        }

        // 3. Confirm with the just-fetched client_secret.
        const { paymentIntent, error: confirmError } = await stripe.confirmPayment({
          elements,
          clientSecret: intentBody.client_secret,
          confirmParams: { return_url: window.location.href },
          redirect: "if_required",
        });
        if (confirmError) {
          const msg = confirmError.message ?? "Card was declined.";
          setErrorMsg(msg);
          onError?.(msg);
          return;
        }
        if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
          // 4. Hand off to parent so it can create the reservation. The parent
          //    handles the slot-race refund path if create-public-booking 409s.
          await onPaid(paymentIntent.id);
        } else {
          const msg = `Payment ended in unexpected state: ${paymentIntent?.status ?? "unknown"}`;
          setErrorMsg(msg);
          onError?.(msg);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [stripe, elements, restaurantId, amountCents, onPaid, onError],
  );

  return (
    <form
      id={formId}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-4"
    >
      <PaymentElement options={{ layout: "tabs" }} />
      {errorMsg ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {errorMsg}
        </div>
      ) : null}
      {hideInternalSubmit ? null : (
        <Button
          type="submit"
          disabled={!stripe || !elements || submitting}
          className="w-full gap-2 font-semibold"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Processing…
            </>
          ) : (
            payButtonLabel
          )}
        </Button>
      )}
    </form>
  );
}

import { useCallback, useMemo, useRef, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { getSupabaseAnonKey, getSupabaseProjectUrl } from "@/lib/supabase/client";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";
import { computeDinerCharge } from "@/lib/stripe-fee";

const STRIPE_PUBLISHABLE_KEY =
  (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string | undefined) ??
  "";

let cachedStripePromise: Promise<StripeJs | null> | null = null;
function getStripePromise(): Promise<StripeJs | null> | null {
  if (!STRIPE_PUBLISHABLE_KEY) return null;
  if (!cachedStripePromise) cachedStripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  return cachedStripePromise;
}

export type SplitTenderPreCheckoutResult = {
  reservation_id: string;
  deposit_row_ids: string[];
};

export type SplitTenderPaymentFormProps = {
  restaurantId: string;
  /** Per-payer share in cents (BASE amount; gross-up via computeDinerCharge). */
  shareCents: number;
  /** N: how many separate cards we collect. */
  payerCount: number;
  /** Optional active hold id — only stamped on slot 0's PI to drive
   *  hold-conversion. Other slots intentionally omit hold_id. */
  holdId?: string | null;
  /**
   * The form's outer <form id={formId}> attribute. The parent's "Place
   * Order" button uses `form={formId}` to trigger submit.
   */
  formId: string;
  /**
   * Called once all N elements have validated locally — the parent
   * creates the reservation (`status='pending_payment'`) + N
   * `reservation_deposit_payments` rows and returns the resolved IDs.
   * If this throws, the form surfaces the error and aborts.
   */
  onPreCheckout: () => Promise<SplitTenderPreCheckoutResult>;
  /** Fired after every slot has reached `'paid'`. */
  onAllPaid: (args: { reservationId: string }) => Promise<void> | void;
  /** Fired on any unrecoverable error (network, all-slots failed). */
  onError?: (msg: string) => void;
};

type SlotStatus = "idle" | "submitting" | "paid" | "failed";

type SlotState = {
  status: SlotStatus;
  errorMsg: string | null;
  paymentIntentId: string | null;
  rowId: string | null;
};

const initialSlotState = (): SlotState => ({
  status: "idle",
  errorMsg: null,
  paymentIntentId: null,
  rowId: null,
});

/**
 * Multi-card split-tender checkout. Mounts N Stripe `<Elements>` instances,
 * one per payer. On submit:
 *   1. Validates all N PaymentElements locally.
 *   2. Calls `onPreCheckout()` to create the reservation + N deposit rows.
 *   3. For each row, creates a PaymentIntent with `deposit_payment_ids=[rowId]`
 *      and idempotency key `split_<reservationId>_<rowId>`.
 *   4. Confirms each PI with its Elements instance.
 *   5. Calls `confirm-deposit-paid` per row.
 *   6. Fires `onAllPaid` when every slot is paid.
 *
 * Security model relies on Vuln 2 hardening (2026-05-20):
 * `create-public-payment-intent` stamps `deposit_payment_ids` on PI metadata;
 * `confirm-deposit-paid` strict-asserts the row id is in that list.
 */
export function SplitTenderPaymentForm(props: SplitTenderPaymentFormProps) {
  const stripePromise = useMemo(() => getStripePromise(), []);
  const { shareCents, payerCount } = props;

  if (!stripePromise) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">
        Stripe is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY.
      </div>
    );
  }
  if (payerCount < 2 || payerCount > 10 || !Number.isFinite(shareCents) || shareCents < 50) {
    return (
      <div className="rounded-xl border border-border bg-bg-elevated/40 p-4 text-sm text-text-muted">
        Set how many people are splitting to enter cards.
      </div>
    );
  }

  return <SplitTenderSurface {...props} stripePromise={stripePromise} />;
}

function SplitTenderSurface({
  restaurantId,
  shareCents,
  payerCount,
  holdId,
  formId,
  onPreCheckout,
  onAllPaid,
  onError,
  stripePromise,
}: SplitTenderPaymentFormProps & { stripePromise: Promise<StripeJs | null> }) {
  // Each slot has its own ref-handle exposing a submit method. We collect
  // them lazily as <SlotInner> instances mount.
  type SlotHandle = {
    submit: (clientSecret: string) => Promise<
      | { ok: true; paymentIntentId: string }
      | { ok: false; error: string }
    >;
  };
  const slotRefs = useRef<Map<number, SlotHandle>>(new Map());
  const [slots, setSlots] = useState<SlotState[]>(() =>
    Array.from({ length: payerCount }, initialSlotState),
  );
  const [submitting, setSubmitting] = useState(false);
  const [topError, setTopError] = useState<string | null>(null);

  // Sync slot-state length to payerCount changes — reset any non-paid rows.
  // Paid rows stay paid even if user fiddles with the count after; the
  // parent should disable the count input once submission is in flight.
  const lastSeenCountRef = useRef(payerCount);
  if (lastSeenCountRef.current !== payerCount) {
    lastSeenCountRef.current = payerCount;
    setSlots((prev) => {
      const next = prev.slice(0, payerCount);
      while (next.length < payerCount) next.push(initialSlotState());
      return next;
    });
  }

  const dinerCharge = useMemo(() => computeDinerCharge(shareCents), [shareCents]);

  const updateSlot = useCallback((idx: number, patch: Partial<SlotState>) => {
    setSlots((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setTopError(null);
      setSubmitting(true);
      try {
        // Step 1: parent creates reservation + N deposit rows.
        // Idempotency: parent should also dedupe this if called twice (we
        // do too via `submitting` flag).
        let pre: SplitTenderPreCheckoutResult;
        try {
          pre = await onPreCheckout();
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Couldn't start checkout.";
          setTopError(msg);
          onError?.(msg);
          return;
        }
        if (pre.deposit_row_ids.length !== payerCount) {
          const msg = `Expected ${payerCount} deposit rows but got ${pre.deposit_row_ids.length}.`;
          setTopError(msg);
          onError?.(msg);
          return;
        }

        // Step 2..4: per-slot pipeline. Run sequentially to keep
        // confirmation order stable (Stripe Elements is finicky about
        // parallel confirmPayment calls on the same browser tab).
        for (let i = 0; i < payerCount; i++) {
          // Skip slots that already succeeded (retry path).
          if (slots[i]?.status === "paid") continue;
          const rowId = pre.deposit_row_ids[i];
          const handle = slotRefs.current.get(i);
          if (!handle) {
            updateSlot(i, { status: "failed", errorMsg: "Slot not mounted", rowId });
            continue;
          }
          updateSlot(i, { status: "submitting", errorMsg: null, rowId });

          // Step 2a: fetch a PI for THIS slot.
          let clientSecret: string | null = null;
          try {
            const piRes = await fetch(
              `${getSupabaseProjectUrl()}/functions/v1/create-public-payment-intent`,
              {
                method: "POST",
                headers: {
                  apikey: getSupabaseAnonKey(),
                  "Content-Type": "application/json",
                  // Idempotency: same key on retry → Stripe dedupes.
                  "x-idempotency-key": `split_${pre.reservation_id}_${rowId}`,
                },
                body: JSON.stringify({
                  restaurant_id: restaurantId,
                  amount_cents: shareCents,
                  deposit_payment_ids: [rowId],
                  // hold_id only on slot 0 — that's the slot that drives
                  // the hold→reservation conversion if a hold is active.
                  hold_id: i === 0 ? holdId ?? null : null,
                }),
              },
            );
            const piBody = (await piRes.json().catch(() => ({}))) as {
              client_secret?: string;
              payment_intent_id?: string;
              error?: string;
            };
            if (!piRes.ok || !piBody.client_secret) {
              const friendly = toUserFacingEdgeError(piRes, piBody);
              updateSlot(i, { status: "failed", errorMsg: friendly.message, rowId });
              continue;
            }
            clientSecret = piBody.client_secret;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Couldn't create payment.";
            updateSlot(i, { status: "failed", errorMsg: msg, rowId });
            continue;
          }

          // Step 2b: confirm via the slot's Elements.
          let paymentIntentId: string | null = null;
          try {
            const result = await handle.submit(clientSecret);
            if (!result.ok) {
              updateSlot(i, { status: "failed", errorMsg: result.error, rowId });
              continue;
            }
            paymentIntentId = result.paymentIntentId;
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Card confirmation failed.";
            updateSlot(i, { status: "failed", errorMsg: msg, rowId });
            continue;
          }

          // Step 2c: tell the server the PI succeeded for THIS row.
          // Retry up to 3 times if it fails on network — the row will
          // also flip via stripe-webhook fallback eventually.
          let confirmed = false;
          for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
            try {
              const cdRes = await fetch(
                `${getSupabaseProjectUrl()}/functions/v1/confirm-deposit-paid`,
                {
                  method: "POST",
                  headers: {
                    apikey: getSupabaseAnonKey(),
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    payment_id: rowId,
                    payment_intent_id: paymentIntentId,
                  }),
                },
              );
              if (cdRes.ok) {
                confirmed = true;
              } else if (attempt === 2) {
                const body = (await cdRes.json().catch(() => ({}))) as { error?: string };
                console.warn("[SplitTender] confirm-deposit-paid failed after 3 tries", body);
                // Treat as paid anyway — Stripe charge succeeded, webhook
                // will reconcile. Surface a soft warning but don't fail
                // the slot.
                confirmed = true;
              } else {
                await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
              }
            } catch (err) {
              if (attempt === 2) {
                console.warn("[SplitTender] confirm-deposit-paid network err", err);
                confirmed = true;
              } else {
                await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
              }
            }
          }

          updateSlot(i, {
            status: "paid",
            errorMsg: null,
            paymentIntentId,
            rowId,
          });
        }

        // Step 3: if every slot ended in 'paid', fire onAllPaid.
        // Re-read fresh state because updateSlot is async; use a setter
        // callback to inspect.
        let everyPaid = false;
        await new Promise<void>((resolve) => {
          setSlots((latest) => {
            everyPaid = latest.every((s) => s.status === "paid");
            return latest;
          });
          resolve();
        });
        if (everyPaid) {
          await onAllPaid({ reservationId: pre.reservation_id });
        } else {
          const failedCount = slots.filter((s) => s.status === "failed").length;
          const friendly = failedCount === 1
            ? "One card couldn't be charged. Re-enter and click Place Order to retry."
            : `${failedCount} cards couldn't be charged. Re-enter them and click Place Order to retry.`;
          setTopError(friendly);
          onError?.(friendly);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting, onPreCheckout, payerCount, slots, restaurantId, shareCents,
      holdId, onAllPaid, onError, updateSlot,
    ],
  );

  return (
    <form id={formId} onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
      {topError ? (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {topError}
        </div>
      ) : null}
      <div className="space-y-1 text-xs text-text-muted">
        <p>
          Each person enters their own card below — we charge {" "}
          <span className="font-medium text-text-primary">
            ${(dinerCharge.dinerTotalCents / 100).toFixed(2)}
          </span> {" "}
          per share (deposit{" "}
          <span className="text-text-primary">
            ${(dinerCharge.baseCents / 100).toFixed(2)}
          </span>{" "}
          + 5.5% platform fee{" "}
          <span className="text-text-primary">
            ${(dinerCharge.cenaivaFeeCents / 100).toFixed(2)}
          </span>{" "}
          + processing fee{" "}
          <span className="text-text-primary">
            ${(dinerCharge.processingFeeCents / 100).toFixed(2)}
          </span>).
        </p>
        <p>
          Platform and processing fees are non-refundable. Each share's
          deposit refunds on arrival.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: payerCount }, (_, idx) => {
          const slot = slots[idx] ?? initialSlotState();
          return (
            <div
              key={idx}
              className={`rounded-xl border p-4 transition-colors ${
                slot.status === "paid"
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : slot.status === "failed"
                  ? "border-danger/40 bg-danger/5"
                  : "border-border bg-bg-elevated/40"
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                  Person {idx + 1}
                </p>
                {slot.status === "paid" ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                    <CheckCircle2 className="size-3.5" /> Paid
                  </span>
                ) : slot.status === "failed" ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-danger">
                    <XCircle className="size-3.5" /> Declined — re-enter
                  </span>
                ) : slot.status === "submitting" ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-text-muted">
                    <Loader2 className="size-3.5 animate-spin" /> Charging…
                  </span>
                ) : null}
              </div>
              {slot.status === "paid" ? (
                <p className="text-xs text-text-muted">
                  Charged {dinerCharge.dinerTotalCents / 100} via{" "}
                  <span className="font-mono text-[10px] text-text-secondary">
                    {slot.paymentIntentId?.slice(0, 16)}…
                  </span>
                </p>
              ) : (
                <Elements
                  stripe={stripePromise}
                  options={{
                    mode: "payment",
                    amount: shareCents,
                    currency: "cad",
                    // Do NOT pin paymentMethodTypes — server uses
                    // automatic_payment_methods so the PI lists `card` + `link`.
                    // Pinning here causes a mismatch that 400s on confirm with
                    // "Payment details were collected through Stripe Elements
                    // using payment_method_types and cannot be confirmed". The
                    // single-payment form (StripePaymentForm) hit + fixed this
                    // bug 2026-05-21; SplitTender just inherited the same fix.
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
                  <SlotInner
                    idx={idx}
                    registerHandle={(h) => slotRefs.current.set(idx, h)}
                    unregisterHandle={() => slotRefs.current.delete(idx)}
                  />
                </Elements>
              )}
              {slot.errorMsg ? (
                <p className="mt-2 text-xs text-danger">{slot.errorMsg}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </form>
  );
}

/**
 * One Stripe `<Elements>` slot. Exposes its `submit(clientSecret)` method
 * via the parent's registry so the parent can drive multi-slot confirm.
 */
function SlotInner({
  idx,
  registerHandle,
  unregisterHandle,
}: {
  idx: number;
  registerHandle: (h: { submit: (cs: string) => Promise<{ ok: true; paymentIntentId: string } | { ok: false; error: string }> }) => void;
  unregisterHandle: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  // Register handle whenever Stripe + Elements are ready. Re-registering
  // on re-mount keeps the parent's ref map fresh after retries.
  if (stripe && elements) {
    registerHandle({
      submit: async (clientSecret: string) => {
        const { error: submitErr } = await elements.submit();
        if (submitErr) {
          const friendly = toUserFacingError(submitErr, "Please check the card details.");
          return { ok: false, error: friendly.message };
        }
        const { paymentIntent, error: confirmErr } = await stripe.confirmPayment({
          elements,
          clientSecret,
          confirmParams: { return_url: window.location.href },
          redirect: "if_required",
        });
        if (confirmErr) {
          const friendly = toUserFacingError(confirmErr, "Card was declined.");
          return { ok: false, error: friendly.message };
        }
        if (
          paymentIntent?.status === "succeeded" ||
          paymentIntent?.status === "processing"
        ) {
          return { ok: true, paymentIntentId: paymentIntent.id };
        }
        return {
          ok: false,
          error: `Unexpected payment status: ${paymentIntent?.status ?? "unknown"}`,
        };
      },
    });
  }
  // Note: unregister on unmount is intentionally left to the parent's
  // count-change effect — a paid slot unmounts (replaced by paid pill)
  // and we want the parent to forget that slot's stale handle.
  void idx;
  void unregisterHandle;

  // Wallet visibility: same config as the single-pay StripePaymentForm so
  // each split slot looks identical to other card-entry surfaces in the app.
  // `link: "never"` suppresses Stripe's "Secure, fast checkout with Link"
  // banner; Apple Pay / Google Pay surface where the device + Stripe account
  // support them (tokenized as cards under the hood).
  return (
    <PaymentElement
      options={{
        layout: "tabs",
        paymentMethodOrder: ["card", "apple_pay", "google_pay"],
        wallets: { applePay: "auto", googlePay: "auto", link: "never" },
        // Collect postal code for Stripe AVS. Mirrors the non-split
        // payment form's setting so every payer's card runs through
        // the same fraud check.
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
  );
}

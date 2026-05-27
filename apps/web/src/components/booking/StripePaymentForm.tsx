import { useCallback, useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { CreditCard, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUser } from "@/hooks/useUser";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
} from "@/lib/supabase/client";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";

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

type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  exp_month: number | null;
  exp_year: number | null;
  is_default: boolean;
};

type StripePaymentFormProps = {
  restaurantId: string;
  /**
   * Food portion (commission-bearing) in cents. Passed to
   * create-public-payment-intent as `amount_cents`. This is the BASE that
   * Cenaiva's 2% commission and Stripe's processing fee are computed on.
   */
  amountCents: number;
  /**
   * Tax portion (HST pass-through) in cents. Optional — defaults to 0.
   * Passed to create-public-payment-intent as `tax_cents` so the server
   * grosses up correctly: tax is added to the diner total but bears no
   * Cenaiva commission. Deposits don't carry tax, so the deposit-only
   * magic-link path leaves this unset.
   */
  taxCents?: number;
  /**
   * Optional active reservation_hold id. When present, gets passed to
   * create-public-payment-intent so the PI's metadata.hold_id is stamped —
   * required for the stripe-webhook fallback path to convert holds when
   * the browser drops between Stripe success and confirm-hold-paid.
   */
  holdId?: string | null;
  /**
   * Optional list of reservation_deposit_payments row IDs. Passed to
   * create-public-payment-intent, stamped on the PI's
   * `metadata.deposit_payment_ids` (comma-joined). confirm-deposit-paid
   * asserts the row's id is in this list before flipping to 'charged' —
   * Vuln 2 full hardening, 2026-05-20.
   */
  depositPaymentIds?: string[] | null;
  /**
   * Fired when the card has been successfully charged. The parent is then
   * responsible for creating the reservation server-side.
   */
  onPaid: (paymentIntentId: string) => Promise<void> | void;
  onError?: (message: string) => void;
  /**
   * Fires whenever the internal form is submitting. The parent uses this
   * to grey-out / spinner an external Place Order button while Stripe is
   * processing — without this, the button stays visually clickable for
   * the 2-5s of the call and users hammer it.
   */
  onProcessingChange?: (processing: boolean) => void;
  payButtonLabel?: string;
  formId?: string;
  hideInternalSubmit?: boolean;
};

/**
 * Diner-side Stripe checkout. Two modes:
 *
 *   - **Saved-card mode** (logged-in diner with ≥1 saved card): renders a
 *     radio-list of saved cards + "Use a different card" toggle. On submit,
 *     calls `create-public-payment-intent` with `saved_card_id` — server
 *     confirms the PI off-session with destination-charge routing. SCA
 *     fallback via `stripe.handleNextAction` if Stripe demands re-auth.
 *
 *   - **One-time mode** (guest checkout OR diner with 0 cards OR diner who
 *     hit "Use a different card"): mounts Stripe Elements PaymentElement,
 *     uses the deferred-PaymentIntent flow. Logged-in diners get an extra
 *     "☑ Save card for faster checkout" checkbox (default-checked) which,
 *     on success, fires `stripe-attach-payment-method` to persist the PM
 *     to the diner's Stripe Customer + insert a `saved_cards` row.
 */
export function StripePaymentForm(props: StripePaymentFormProps) {
  const stripePromise = useMemo(() => getStripePromise(), []);
  const { user, loading: userLoading } = useUser();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);

  // Fetch saved cards once we know there's a logged-in user. Guests skip
  // this entirely (one-time-card mode forever).
  useEffect(() => {
    if (userLoading) return;
    if (!user) {
      setCards([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      setCardsLoading(true);
      try {
        const client = getSupabaseBrowserClient();
        const { data: { session } } = await client.auth.getSession();
        if (!session) {
          if (!cancelled) setCards([]);
          return;
        }
        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/stripe-list-methods`,
          {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: getSupabaseAnonKey(),
            },
          },
        );
        if (res.ok) {
          const body = (await res.json()) as { methods?: SavedCard[] };
          if (!cancelled) setCards(body.methods ?? []);
        }
      } finally {
        if (!cancelled) setCardsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, userLoading]);

  if (!stripePromise) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        Stripe is not configured. Set VITE_STRIPE_PUBLISHABLE_KEY in the web app env.
      </div>
    );
  }
  if (props.amountCents + (props.taxCents ?? 0) < 50) {
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
        Total is below Stripe's 50¢ minimum charge.
      </div>
    );
  }

  if (userLoading || cardsLoading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-surface/60 p-4 text-sm text-text-secondary">
        <Loader2 className="size-4 animate-spin" /> Loading payment options…
      </div>
    );
  }

  return (
    <PaymentSurface
      stripePromise={stripePromise}
      cards={cards}
      isLoggedIn={Boolean(user)}
      restaurantId={props.restaurantId}
      amountCents={props.amountCents}
      taxCents={props.taxCents ?? 0}
      holdId={props.holdId ?? null}
      depositPaymentIds={props.depositPaymentIds ?? null}
      onPaid={props.onPaid}
      onError={props.onError}
      onProcessingChange={props.onProcessingChange}
      payButtonLabel={props.payButtonLabel ?? "Pay & confirm"}
      formId={props.formId}
      hideInternalSubmit={props.hideInternalSubmit}
    />
  );
}

function PaymentSurface({
  stripePromise,
  cards,
  isLoggedIn,
  restaurantId,
  amountCents,
  taxCents,
  holdId,
  depositPaymentIds,
  onPaid,
  onError,
  onProcessingChange,
  payButtonLabel,
  formId,
  hideInternalSubmit,
}: {
  stripePromise: Promise<StripeJs | null>;
  cards: SavedCard[];
  isLoggedIn: boolean;
  restaurantId: string;
  amountCents: number;
  taxCents: number;
  holdId: string | null;
  depositPaymentIds: string[] | null;
  onPaid: (paymentIntentId: string) => Promise<void> | void;
  onError?: (message: string) => void;
  onProcessingChange?: (processing: boolean) => void;
  payButtonLabel: string;
  formId?: string;
  hideInternalSubmit?: boolean;
}) {
  // Picker default: saved cards exist → picker mode, default to is_default
  // card. Otherwise: one-time mode immediately.
  const defaultCardId = useMemo(() => {
    if (cards.length === 0) return null;
    const def = cards.find((c) => c.is_default) ?? cards[0];
    return def.id;
  }, [cards]);

  // null = use a different card (one-time mode within an otherwise-picker
  // context). Set to a card id = saved-card mode. Initial value: default
  // card id if any saved cards exist.
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string | null>(
    defaultCardId,
  );

  // When `selectedSavedCardId === null` AND `cards.length > 0`, we're in
  // "use a different card" mode — Elements mounts so the diner can enter
  // a fresh card. When cards.length === 0, this is just one-time mode.
  const inOneTimeMode = selectedSavedCardId === null;

  // Logged-in diners get the "save card" checkbox on one-time mode.
  // Defaults to true (industry data: 73% opt to save when defaulted on).
  const [saveCard, setSaveCard] = useState(true);

  if (cards.length > 0 && !inOneTimeMode) {
    // Saved-card picker (no Elements mount needed).
    return (
      <SavedCardPath
        cards={cards}
        selectedId={selectedSavedCardId!}
        onSelectId={setSelectedSavedCardId}
        onAddDifferent={() => setSelectedSavedCardId(null)}
        restaurantId={restaurantId}
        amountCents={amountCents}
        taxCents={taxCents}
        holdId={holdId}
        depositPaymentIds={depositPaymentIds}
        onPaid={onPaid}
        onError={onError}
        onProcessingChange={onProcessingChange}
        payButtonLabel={payButtonLabel}
        formId={formId}
        hideInternalSubmit={hideInternalSubmit}
        stripePromise={stripePromise}
      />
    );
  }

  // One-time mode: mount Elements (only here — saving cycles on saved-card
  // mode where Elements isn't needed).
  //
  // Important: the `key` forces a fresh <Elements> instance whenever the
  // diner toggles "Save this card". Without it, the Elements provider
  // memoizes its options at first mount and a later toggle leaves
  // `setupFutureUsage` stale relative to what the PI gets created with —
  // Stripe then 400s on confirm: "setup_future_usage (null) does not
  // match the value that was provided when the PaymentIntent was
  // created (off_session)".
  return (
    <Elements
      key={`elements-save-${saveCard ? "1" : "0"}`}
      stripe={stripePromise}
      options={{
        mode: "payment",
        // Hint for wallet payment sheets only — server PI is the source of
        // truth on the actual charge amount. Include tax so the Apple/Google
        // Pay sheet shows a representative total close to what the diner
        // actually pays.
        amount: amountCents + taxCents,
        currency: "cad",
        // Card + wallets: the server PI now uses `automatic_payment_methods`
        // with `allow_redirects: "never"`, which yields card + Link (and on
        // mobile / Safari wallets). We do NOT pin `paymentMethodTypes` here
        // — that creates an Elements/PI mismatch that 400s on confirm with
        // "PaymentIntent does not have allowed_payment_method_types"
        // (Bug discovered 2026-05-21 in final test wave). Letting Elements
        // read methods from the PI keeps client + server in lockstep.
        // Save-card flag — must match the PI's setup_future_usage on
        // server. When the logged-in diner ticked "Save this card",
        // both Elements and the server PI need this so Stripe attaches
        // the PM to their customer during the charge.
        ...(isLoggedIn && saveCard
          ? { setupFutureUsage: "off_session" as const }
          : {}),
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
      <OneTimeCardForm
        restaurantId={restaurantId}
        amountCents={amountCents}
        taxCents={taxCents}
        holdId={holdId}
        depositPaymentIds={depositPaymentIds}
        onPaid={onPaid}
        onError={onError}
        onProcessingChange={onProcessingChange}
        payButtonLabel={payButtonLabel}
        formId={formId}
        hideInternalSubmit={hideInternalSubmit}
        isLoggedIn={isLoggedIn}
        saveCard={saveCard}
        onChangeSaveCard={setSaveCard}
        hasSavedCards={cards.length > 0}
        onBackToSavedPicker={() => setSelectedSavedCardId(defaultCardId)}
      />
    </Elements>
  );
}

/** Saved-card path: radio picker + "use different card" toggle + Pay button. */
function SavedCardPath({
  cards,
  selectedId,
  onSelectId,
  onAddDifferent,
  restaurantId,
  amountCents,
  taxCents,
  holdId,
  depositPaymentIds,
  onPaid,
  onError,
  onProcessingChange,
  payButtonLabel,
  formId,
  hideInternalSubmit,
  stripePromise,
}: {
  cards: SavedCard[];
  selectedId: string;
  onSelectId: (id: string) => void;
  onAddDifferent: () => void;
  restaurantId: string;
  amountCents: number;
  taxCents: number;
  holdId: string | null;
  depositPaymentIds: string[] | null;
  onPaid: (paymentIntentId: string) => Promise<void> | void;
  onError?: (message: string) => void;
  onProcessingChange?: (processing: boolean) => void;
  payButtonLabel: string;
  formId?: string;
  hideInternalSubmit?: boolean;
  stripePromise: Promise<StripeJs | null>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Bubble the local submitting state up so the parent's external
  // Place Order button can spinner / grey-out during the Stripe call.
  useEffect(() => {
    onProcessingChange?.(submitting);
  }, [submitting, onProcessingChange]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      setErrorMsg(null);
      try {
        const client = getSupabaseBrowserClient();
        const { data: { session } } = await client.auth.getSession();
        if (!session) {
          const msg = "Your session expired. Please sign in again.";
          setErrorMsg(msg);
          onError?.(msg);
          return;
        }

        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/create-public-payment-intent`,
          {
            method: "POST",
            headers: {
              apikey: getSupabaseAnonKey(),
              Authorization: `Bearer ${session.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              restaurant_id: restaurantId,
              amount_cents: amountCents,
              tax_cents: taxCents,
              saved_card_id: selectedId,
              hold_id: holdId,
              deposit_payment_ids: depositPaymentIds ?? undefined,
              // Bug #110 fix: fresh UUID per booking attempt so distinct
              // bookings by the same diner for the same amount get distinct
              // PIs (was sharing T1's PI across all bookings).
              idempotency_key: crypto.randomUUID(),
            }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as {
          mode?: string;
          status?: "succeeded" | "requires_action" | "failed";
          payment_intent_id?: string;
          client_secret?: string;
          error?: string;
        };

        if (body.status === "succeeded" && body.payment_intent_id) {
          await onPaid(body.payment_intent_id);
          return;
        }
        if (body.status === "requires_action" && body.client_secret) {
          // SCA challenge — load Stripe.js, call handleNextAction.
          const stripe = await stripePromise;
          if (!stripe) {
            const msg = "Stripe failed to load. Please try again.";
            setErrorMsg(msg);
            onError?.(msg);
            return;
          }
          const { paymentIntent, error: scaErr } = await stripe.handleNextAction({
            clientSecret: body.client_secret,
          });
          if (scaErr) {
            const friendly = toUserFacingError(scaErr, "Card verification failed.");
            setErrorMsg(friendly.message);
            onError?.(friendly.message);
            console.error("[StripePaymentForm.savedCard.sca]", friendly.code, friendly.technical ?? scaErr);
            return;
          }
          if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
            await onPaid(paymentIntent.id);
            return;
          }
          const msg = `Payment ended in unexpected state: ${paymentIntent?.status ?? "unknown"}`;
          setErrorMsg(msg);
          onError?.(msg);
          return;
        }
        if (!res.ok) {
          const friendly = toUserFacingEdgeError(res, body);
          setErrorMsg(friendly.message);
          onError?.(friendly.message);
          console.error("[StripePaymentForm.savedCard.intent]", friendly.code, friendly.technical);
          return;
        }
        const msg = body.error ?? "Couldn't charge your card.";
        setErrorMsg(msg);
        onError?.(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, restaurantId, amountCents, taxCents, selectedId, depositPaymentIds, holdId, onPaid, onError, stripePromise],
  );

  return (
    <form
      id={formId}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-3"
    >
      <div className="space-y-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          Pay with
        </p>
        {cards.map((card) => (
          <label
            key={card.id}
            className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors ${
              selectedId === card.id
                ? "border-gold/60 bg-gold/5"
                : "border-border bg-bg-surface/60 hover:border-border-strong"
            }`}
          >
            <input
              type="radio"
              name="saved-card"
              value={card.id}
              checked={selectedId === card.id}
              onChange={() => onSelectId(card.id)}
              className="size-4 accent-gold"
            />
            <CreditCard className="size-4 text-text-muted" />
            <span className="flex-1 text-sm text-white">
              <span className="capitalize">{card.brand}</span> •••• {card.last4}
              {card.is_default ? (
                <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-medium text-gold">
                  Default
                </span>
              ) : null}
            </span>
            {card.exp_month && card.exp_year ? (
              <span className="text-xs text-text-muted">
                {String(card.exp_month).padStart(2, "0")}/{String(card.exp_year).slice(-2)}
              </span>
            ) : null}
          </label>
        ))}
        <button
          type="button"
          onClick={onAddDifferent}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-bg-surface/30 p-3 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <Plus className="size-4" /> Use a different card
        </button>
      </div>

      {errorMsg ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {errorMsg}
        </div>
      ) : null}

      {hideInternalSubmit ? null : (
        <Button
          type="submit"
          disabled={submitting}
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

/** One-time card path: PaymentElement + (optional) save-card checkbox. */
function OneTimeCardForm({
  restaurantId,
  amountCents,
  taxCents,
  holdId,
  depositPaymentIds,
  onPaid,
  onError,
  onProcessingChange,
  payButtonLabel,
  formId,
  hideInternalSubmit,
  isLoggedIn,
  saveCard,
  onChangeSaveCard,
  hasSavedCards,
  onBackToSavedPicker,
}: {
  restaurantId: string;
  amountCents: number;
  taxCents: number;
  holdId: string | null;
  depositPaymentIds: string[] | null;
  onPaid: (paymentIntentId: string) => Promise<void> | void;
  onError?: (message: string) => void;
  onProcessingChange?: (processing: boolean) => void;
  payButtonLabel: string;
  formId?: string;
  hideInternalSubmit?: boolean;
  isLoggedIn: boolean;
  saveCard: boolean;
  onChangeSaveCard: (v: boolean) => void;
  hasSavedCards: boolean;
  onBackToSavedPicker: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Bubble the local submitting state up so the parent's external
  // Place Order button can spinner / grey-out during the Stripe call.
  useEffect(() => {
    onProcessingChange?.(submitting);
  }, [submitting, onProcessingChange]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!stripe || !elements) return;
      // Re-entrance guard. The external Place Order button is disabled via
      // the parent's `paymentProcessing` state, which is NOT wired to this
      // hook's local `submitting`. Without this guard, rapid clicks fire
      // multiple handleSubmits in parallel, each creating a fresh
      // PaymentIntent — Stripe records 4-5 abandoned PIs per booking and
      // throws "elements.submit() must be called before stripe.confirmPayment"
      // on the racing calls.
      if (submitting) return;
      setSubmitting(true);
      setErrorMsg(null);
      try {
        // 1. Validate card fields locally before hitting the server.
        const { error: submitError } = await elements.submit();
        if (submitError) {
          const friendly = toUserFacingError(submitError, "Please check your card details.");
          setErrorMsg(friendly.message);
          onError?.(friendly.message);
          console.error("[StripePaymentForm.oneTime.submit]", friendly.code, friendly.technical ?? submitError);
          return;
        }

        // 2. Create the PaymentIntent JIT. When the diner is logged in
        // and ticked "save this card", we pass `save_card: true` AND a
        // bearer token so the server can attach the PI to their Stripe
        // customer with setup_future_usage. Without this the PM is
        // one-time-use and can't be saved post-charge.
        const intentHeaders: Record<string, string> = {
          apikey: getSupabaseAnonKey(),
          "Content-Type": "application/json",
        };
        if (isLoggedIn && saveCard) {
          const client = getSupabaseBrowserClient();
          const { data: sessionData } = await client.auth.getSession();
          const token = sessionData.session?.access_token;
          if (token) intentHeaders.Authorization = `Bearer ${token}`;
        }
        const intentRes = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/create-public-payment-intent`,
          {
            method: "POST",
            headers: intentHeaders,
            body: JSON.stringify({
              restaurant_id: restaurantId,
              amount_cents: amountCents,
              tax_cents: taxCents,
              hold_id: holdId,
              save_card: isLoggedIn && saveCard,
              deposit_payment_ids: depositPaymentIds ?? undefined,
              // Bug #110 fix: fresh UUID per booking attempt so distinct
              // bookings by the same diner for the same amount get distinct
              // PIs (was sharing T1's PI across all bookings).
              idempotency_key: crypto.randomUUID(),
            }),
          },
        );
        const intentBody = (await intentRes.json().catch(() => ({}))) as {
          client_secret?: string;
          payment_intent_id?: string;
          error?: string;
        };
        if (!intentRes.ok || !intentBody.client_secret) {
          const friendly = toUserFacingEdgeError(intentRes, intentBody);
          setErrorMsg(friendly.message);
          onError?.(friendly.message);
          console.error("[StripePaymentForm.oneTime.intent]", friendly.code, friendly.technical);
          return;
        }

        // 3. Confirm with the just-fetched client_secret. We MUST pass empty
        // strings for every address field we set to `fields.billingDetails.
        // address.* = "never"` above — Stripe enforces parity between the
        // PaymentElement fields config and confirmParams.payment_method_data.
        // Missing this throws IntegrationError and silently kills Place Order.
        const { paymentIntent, error: confirmError } = await stripe.confirmPayment({
          elements,
          clientSecret: intentBody.client_secret,
          confirmParams: {
            return_url: window.location.href,
            payment_method_data: {
              billing_details: {
                address: {
                  line1: "",
                  line2: "",
                  city: "",
                  state: "",
                },
              },
            },
          },
          redirect: "if_required",
        });
        if (confirmError) {
          const friendly = toUserFacingError(confirmError, "Card was declined.");
          setErrorMsg(friendly.message);
          onError?.(friendly.message);
          console.error("[StripePaymentForm.oneTime.confirm]", friendly.code, friendly.technical ?? confirmError);
          return;
        }
        if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
          // 4. Fire onPaid so the parent can create the reservation. The
          //    save-card attach happens in parallel — never block the booking.
          const piId = paymentIntent.id;
          if (isLoggedIn && saveCard) {
            void attachPaymentMethodInBackground(piId);
          }
          await onPaid(piId);
        } else {
          const msg = `Payment ended in unexpected state: ${paymentIntent?.status ?? "unknown"}`;
          setErrorMsg(msg);
          onError?.(msg);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, stripe, elements, restaurantId, amountCents, taxCents, holdId, depositPaymentIds, onPaid, onError, isLoggedIn, saveCard],
  );

  return (
    <form
      id={formId}
      onSubmit={(e) => void handleSubmit(e)}
      className="flex flex-col gap-4"
    >
      {hasSavedCards ? (
        <button
          type="button"
          onClick={onBackToSavedPicker}
          className="self-start text-xs font-medium text-text-secondary underline-offset-4 hover:text-white hover:underline"
        >
          ← Use a saved card instead
        </button>
      ) : null}
      <PaymentElement
        options={{
          layout: "tabs",
          // Card + wallets only. Server pins payment_method_types=['card']
          // on the PI which still allows Apple Pay & Google Pay (they're
          // tokenized cards under the hood) — Klarna / Affirm never appear.
          // `link: "never"` suppresses the "Secure, fast checkout with
          // Link" banner that mounts above the card form.
          paymentMethodOrder: ["card", "apple_pay", "google_pay"],
          wallets: { applePay: "auto", googlePay: "auto", link: "never" },
          // Collect postal code so Stripe's AVS fraud check runs on each
          // charge. Other address fields stay hidden to keep the form
          // short — diners abandoning the booking flow is more costly
          // than the lower fraud signal a missing line1 might cause.
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
      {isLoggedIn ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={saveCard}
            onChange={(e) => onChangeSaveCard(e.target.checked)}
            className="size-4 accent-gold"
          />
          Save this card for faster checkout next time
        </label>
      ) : null}
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

// Fire-and-forget save: never blocks the booking success path. If it
// fails, the diner just won't have the card on file for next time;
// they can add it manually from /account.
async function attachPaymentMethodInBackground(paymentIntentId: string): Promise<void> {
  try {
    const client = getSupabaseBrowserClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session) return;
    await fetch(
      `${getSupabaseProjectUrl()}/functions/v1/stripe-attach-payment-method`,
      {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      },
    );
  } catch (err) {
    console.warn("[booking] stripe-attach-payment-method failed", err);
  }
}

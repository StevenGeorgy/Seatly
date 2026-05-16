import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { Button } from "@/components/ui/button";
import {
  getSupabaseAnonKey,
  getSupabaseProjectUrl,
} from "@/lib/supabase/client";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";

// Phase 7 of diner auth overhaul (2026-05-15): public landing page
// for the magic links emailed to split-deposit payers. Anyone with
// the payment_id (a UUID, infeasible to guess) can pay their share.
//
// Flow:
//   1. Fetch context via get-deposit-payment-context (returns
//      reservation summary + payer info + restaurant name)
//   2. Show "Hi <name>, your share is $X for dinner at <restaurant>"
//   3. If already paid → "Thanks, your share is already in" + done
//   4. If pending → mount StripePaymentForm with restaurant_id +
//      this row's amount. On `onPaid(paymentIntentId)`, call
//      confirm-deposit-paid to mark the row charged. Settle trigger
//      flips the reservation to 'confirmed' once all rows are charged.

type DepositContext = {
  payment: {
    id: string;
    amount_cents: number;
    status: string;
    payer_email: string | null;
    payer_full_name: string | null;
    is_paid: boolean;
  };
  reservation: {
    id: string;
    reserved_at: string;
    party_size: number;
    organizer_full_name: string | null;
    status: string;
  };
  restaurant: {
    id: string;
    name: string | null;
    slug: string;
    currency: string;
    timezone: string | null;
    cover_photo_url: string | null;
    has_stripe_account: boolean;
  };
};

export default function DepositPayPage() {
  const { id: paymentId } = useParams<{ id: string }>();
  const [context, setContext] = useState<DepositContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    if (!paymentId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/get-deposit-payment-context`,
          {
            method: "POST",
            headers: {
              apikey: getSupabaseAnonKey(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ payment_id: paymentId }),
          },
        );
        const body = (await res.json().catch(() => ({}))) as
          | DepositContext
          | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in body) {
          const friendly = toUserFacingEdgeError(
            res,
            "error" in body ? { error: body.error } : null,
          );
          setError(friendly.message);
          console.error("[DepositPayPage.loadContext]", friendly.code, friendly.technical);
          return;
        }
        setContext(body as DepositContext);
        if ((body as DepositContext).payment.is_paid) {
          setPaid(true);
        }
      } catch (err) {
        if (!cancelled) {
          const friendly = toUserFacingError(err, "Couldn't load payment details.");
          setError(friendly.message);
          console.error("[DepositPayPage.loadContext]", friendly.code, friendly.technical ?? err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentId]);

  const reservedDateLabel = useMemo(() => {
    if (!context) return "";
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: context.restaurant.timezone ?? undefined,
    }).format(new Date(context.reservation.reserved_at));
  }, [context]);

  const handlePaid = async (paymentIntentId: string) => {
    if (!paymentId) return;
    try {
      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/confirm-deposit-paid`,
        {
          method: "POST",
          headers: {
            apikey: getSupabaseAnonKey(),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            payment_id: paymentId,
            payment_intent_id: paymentIntentId,
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || body.error) {
        const friendly = toUserFacingEdgeError(res, body);
        toast.error(
          friendly.code === "unknown"
            ? "Payment confirmed, but we couldn't link it. Contact support."
            : friendly.message,
        );
        console.error("[DepositPayPage.confirmPaid]", friendly.code, friendly.technical);
        // Still mark paid optimistically — Stripe has the money.
      }
      setPaid(true);
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't finalize the payment.");
      toast.error(friendly.message);
      console.error("[DepositPayPage.confirmPaid]", friendly.code, friendly.technical ?? err);
      setPaid(true);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[640px] px-5 py-10 lg:px-8 lg:py-12">
        {loading && (
          <div className="rounded-3xl border border-border bg-bg-surface/50 p-8 text-sm text-text-muted">
            <Loader2 className="size-5 animate-spin" />
            Loading payment details…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-3xl border border-border bg-bg-surface/50 p-8">
            <p className="font-serif text-3xl text-white">Link not valid</p>
            <p className="mt-2 text-sm text-text-secondary">{error}</p>
            <p className="mt-4 text-xs text-text-muted">
              Ask the person who invited you to send a fresh link, or contact the restaurant.
            </p>
          </div>
        )}

        {!loading && !error && context && paid && (
          <div className="rounded-3xl border border-success/30 bg-success/5 p-8">
            <CheckCircle2 className="size-10 text-success" />
            <p className="mt-4 font-serif text-3xl text-white">You're in</p>
            <p className="mt-2 text-sm text-text-secondary">
              Your share for {context.restaurant.name ?? "the restaurant"} on {reservedDateLabel}
              {" "}is paid. Once everyone in the party has paid their share, the reservation
              will be confirmed.
            </p>
            <p className="mt-4 text-xs text-text-muted">
              You don't need to do anything else.
            </p>
            <Button asChild className="mt-6">
              <Link to="/discover">Browse other restaurants</Link>
            </Button>
          </div>
        )}

        {!loading && !error && context && !paid && (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-3xl border border-border bg-bg-surface shadow-2xl shadow-black/30">
              {context.restaurant.cover_photo_url ? (
                <div className="relative h-40 w-full">
                  <img
                    src={context.restaurant.cover_photo_url}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/60" />
                </div>
              ) : null}
              <div className="p-6">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Chip in for dinner
                </p>
                <h1 className="mt-1 font-serif text-3xl text-white">
                  {context.restaurant.name ?? "Restaurant"}
                </h1>
                <p className="mt-1 text-sm text-text-secondary">
                  Hi {context.payment.payer_full_name?.trim() || "there"},{" "}
                  <span className="text-white">
                    {context.reservation.organizer_full_name?.trim() || "your friend"}
                  </span>{" "}
                  booked dinner for {context.reservation.party_size}{" "}
                  {context.reservation.party_size === 1 ? "guest" : "guests"} on{" "}
                  <span className="text-white">{reservedDateLabel}</span> and asked you to
                  pay your share of the deposit.
                </p>
                <div className="mt-6 flex items-end justify-between rounded-2xl border border-border bg-bg-base/50 p-5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                    Your share
                  </span>
                  <span className="text-3xl font-semibold text-gold">
                    {context.restaurant.currency} $
                    {(context.payment.amount_cents / 100).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-bg-surface p-6">
              <h2 className="font-serif text-2xl text-white">Pay with card</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Refundable if the booking is cancelled. The restaurant won't see your card
                details.
              </p>
              <div className="mt-4">
                <StripePaymentForm
                  restaurantId={context.restaurant.id}
                  amountCents={context.payment.amount_cents}
                  onPaid={handlePaid}
                  payButtonLabel={`Pay ${context.restaurant.currency} $${(context.payment.amount_cents / 100).toFixed(2)}`}
                />
              </div>
            </div>

            <p className="text-center text-xs text-text-muted">
              The reservation isn't confirmed until everyone pays. You'll get an email
              when it's locked in.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

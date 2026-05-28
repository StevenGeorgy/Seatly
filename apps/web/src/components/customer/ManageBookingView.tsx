import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, Clock, Loader2, PencilLine, Users } from "lucide-react";
import { useUser } from "@/hooks/useUser";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ModifyBookingFields,
  type ModifyBookingValidity,
  type ModifyBookingValues,
} from "@/components/booking/ModifyBookingFields";
import { RefundRequestDialog } from "@/components/customer/RefundRequestDialog";
import {
  BookingPaymentContactCard,
  type BookingPaymentCardSplitTender,
} from "@/components/customer/BookingPaymentContactCard";
import {
  EditPreorderModal,
  type EditPreorderAuth,
  type EditPreorderInitialItem,
} from "@/components/customer/EditPreorderModal";
import { formatPaymentMethods } from "@/lib/booking/paymentMethods";
import { invalidateAvailabilityCache } from "@/hooks/useAvailability";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { formatCompactTimeLabel, to24HourTime } from "@/lib/utils/time";
import { cn } from "@/lib/utils";
import { toUserFacingError, toUserFacingEdgeError } from "@/lib/errors";

// 2026-05-28: shape returned by lookup_reservation_details(slug, code, email).
// The RPC returns a single JSONB blob with nested reservation, restaurant,
// deposit_tier, orders[], deposits[] objects. We re-type defensively here
// because the RPC's return type is `jsonb` from PostgREST's POV.
export type ReservationDetailsOrderItem = {
  id: string;
  menu_item_id: string | null;
  name: string;
  quantity: number;
  unit_price: number;
  line_total: number | null;
};

export type ReservationDetailsOrder = {
  id: string;
  status: string;
  subtotal: number | null;
  tax_amount: number | null;
  tip_amount: number | null;
  total_amount: number | null;
  is_preorder: boolean | null;
  stripe_payment_intent_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  items: ReservationDetailsOrderItem[];
};

export type ReservationDetailsDeposit = {
  id: string;
  payer_full_name: string | null;
  payer_email: string | null;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  card_brand: string | null;
  card_last4: string | null;
  stripe_payment_intent_id: string | null;
};

export type ReservationDetailsBlob = {
  reservation: {
    id: string;
    confirmation_code: string | null;
    status: string | null;
    reserved_at: string;
    party_size: number;
    duration_minutes: number | null;
    special_request: string | null;
    guest_full_name: string | null;
    guest_email: string | null;
    guest_phone: string | null;
    applied_promo_code: string | null;
    cancelled_at: string | null;
    cancellation_reason: string | null;
    seated_at: string | null;
    no_show_at: string | null;
    completed_at: string | null;
    deposit_amount_cents: number | null;
    deposit_status: string | null;
  };
  restaurant: {
    id: string;
    name: string | null;
    slug: string | null;
    address: string | null;
    phone: string | null;
    city: string | null;
    province: string | null;
    timezone: string | null;
    tax_rate: number | null;
    logo_url: string | null;
    cover_photo_url: string | null;
  };
  deposit_tier: {
    min_party_size: number;
    amount_per_person_cents: number;
    total_cents: number;
  } | null;
  orders: ReservationDetailsOrder[];
  deposits: ReservationDetailsDeposit[];
};

// Narrow view used by the existing render path (date/time/party UI etc.).
// Mapped from the JSONB blob so the rest of this component keeps the
// same field names without churn.
type LookupRow = {
  id: string;
  restaurant_id: string;
  reserved_at: string;
  party_size: number;
  status: string | null;
  guest_full_name: string | null;
  duration_minutes: number | null;
  special_request: string | null;
  restaurant_name: string | null;
  restaurant_timezone: string | null;
  deposit_status: string | null;
};

type Props = {
  slug: string;
  code: string;
  /**
   * Email used to re-prove identity on guest cancel/modify calls. Forwarded
   * from `/find-reservation` via the `?email=` URL param. Required for guest
   * paths since 2026-05-22 (closes the code-only enumeration attack). When
   * absent on the manage view, the cancel button will surface a "use the
   * find-reservation flow" message instead of attempting an auth-less call.
   */
  email: string | null;
  backHref: string;
};

const FINAL_STATUSES = new Set(["cancelled", "completed", "no_show"]);

function formatLocalDate(iso: string, tz: string | null): { date: string; time: string } {
  const date = new Date(iso);
  const tzSafe = tz ?? "America/Toronto";
  const dateLabel = date.toLocaleDateString("en-US", {
    timeZone: tzSafe,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeLabel = date.toLocaleTimeString("en-US", {
    timeZone: tzSafe,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return { date: dateLabel, time: timeLabel };
}

function isoDateInTz(iso: string, tz: string | null): string {
  const date = new Date(iso);
  const tzSafe = tz ?? "America/Toronto";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzSafe,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}`;
}

function isoTimeInTz(iso: string, tz: string | null): string {
  const date = new Date(iso);
  const tzSafe = tz ?? "America/Toronto";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tzSafe,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const lookup = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${lookup("hour")}:${lookup("minute")}`;
}

export function ManageBookingView({ slug, code, email, backHref }: Props) {
  const navigate = useNavigate();
  const { user } = useUser();
  const [reservation, setReservation] = useState<LookupRow | null>(null);
  // 2026-05-28: full enriched blob from lookup_reservation_details. We
  // keep the narrow LookupRow above for the existing cancel/modify code
  // paths and use this for the new "Payment & contact details" section.
  // NULL when the (slug, code, email) trio doesn't resolve or when the
  // page is still loading.
  const [details, setDetails] = useState<ReservationDetailsBlob | null>(null);
  const [lookupState, setLookupState] = useState<"loading" | "found" | "missing" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guest path identity proof: a logged-out caller MUST present the email
  // alongside the confirmation code. Old confirmation links (sent before
  // 2026-05-22) only carry the code in the URL — for those we redirect to
  // /find-reservation so the diner re-enters the email and we re-emit a
  // URL that includes both. Logged-in callers bypass this entirely.
  const isLoggedIn = Boolean(user);
  const guestNeedsEmail = !isLoggedIn && !email;

  const [mode, setMode] = useState<"view" | "modify" | "confirmCancel" | "done">("view");
  const [busy, setBusy] = useState(false);
  // Gap 4 (2026-05-21): in-app refund request flow. Shown when the diner
  // was actually charged (deposit_status=charged) AND the reservation is
  // already completed — active reservations should use the standard
  // cancel flow which auto-refunds.
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);

  // Modify form state — driven by the shared ModifyBookingFields component.
  const [modifyInitial, setModifyInitial] = useState<ModifyBookingValues | null>(null);
  const [modifyValues, setModifyValues] = useState<ModifyBookingValues | null>(null);
  const [modifyValidity, setModifyValidity] = useState<ModifyBookingValidity>({
    canSave: false,
    reason: null,
    reasonKind: null,
  });

  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  // 2026-05-27: edit-pre-order modal state. Single source for mutual
  // exclusion with the `mode === "modify"` slot panel.
  const [preorderOpen, setPreorderOpen] = useState(false);
  // Bump to retrigger the lookup useEffect after a successful save.
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!isSupabaseConfigured()) {
        if (!cancelled) {
          setLookupState("error");
          setErrorMessage("Supabase is not configured.");
        }
        return;
      }
      // 2026-05-28: guest path now uses the enriched
      // lookup_reservation_details RPC, which requires (slug, code,
      // email). When the diner navigated here without an email param,
      // we short-circuit to the "verify your email" UI — same gate as
      // the cancel/modify edge fns enforce. Logged-in callers can fall
      // back to the original by-code lookup so they still see the page
      // even without forwarding the email.
      const client = getSupabaseBrowserClient();
      const isLoggedInCaller = Boolean(user);
      if (!email && !isLoggedInCaller) {
        if (!cancelled) {
          setLookupState("missing");
        }
        return;
      }

      if (email) {
        const { data, error } = await client.rpc("lookup_reservation_details", {
          p_slug: slug,
          p_code: code,
          p_email: email,
        });
        if (cancelled) return;
        if (error) {
          const friendly = toUserFacingError(error, "Couldn't load this reservation. Try again.");
          setLookupState("error");
          setErrorMessage(friendly.message);
          console.error("[ManageBookingView.lookup]", friendly.code, friendly.technical ?? error);
          return;
        }
        const blob = (data as ReservationDetailsBlob | null) ?? null;
        if (!blob || !blob.reservation) {
          setLookupState("missing");
          return;
        }
        setDetails(blob);
        const row: LookupRow = {
          id: blob.reservation.id,
          restaurant_id: blob.restaurant.id,
          reserved_at: blob.reservation.reserved_at,
          party_size: blob.reservation.party_size,
          status: blob.reservation.status,
          guest_full_name: blob.reservation.guest_full_name,
          duration_minutes: blob.reservation.duration_minutes,
          special_request: blob.reservation.special_request,
          restaurant_name: blob.restaurant.name,
          restaurant_timezone: blob.restaurant.timezone,
          deposit_status: blob.reservation.deposit_status,
        };
        setReservation(row);
        setLookupState("found");
        const initial: ModifyBookingValues = {
          date: isoDateInTz(row.reserved_at, row.restaurant_timezone),
          time: isoTimeInTz(row.reserved_at, row.restaurant_timezone),
          partySize: row.party_size,
          notes: row.special_request ?? "",
        };
        setModifyInitial(initial);
        setModifyValues(initial);
        setModifyValidity({ canSave: false, reason: null, reasonKind: null });
        return;
      }

      // Logged-in caller, no email forwarded: fall back to the legacy
      // code-only lookup so we don't strand them at "verify your
      // email". They lose the enriched payment-detail section but the
      // base manage UI still works.
      const { data, error } = await client.rpc("lookup_reservation_by_code", {
        p_slug: slug,
        p_code: code,
      });
      if (cancelled) return;
      if (error) {
        const friendly = toUserFacingError(error, "Couldn't load this reservation. Try again.");
        setLookupState("error");
        setErrorMessage(friendly.message);
        console.error("[ManageBookingView.lookup]", friendly.code, friendly.technical ?? error);
        return;
      }
      const rows = (data as LookupRow[] | null) ?? [];
      if (!rows.length) {
        setLookupState("missing");
        return;
      }
      const row = rows[0];
      setReservation(row);
      setLookupState("found");
      const initial: ModifyBookingValues = {
        date: isoDateInTz(row.reserved_at, row.restaurant_timezone),
        time: isoTimeInTz(row.reserved_at, row.restaurant_timezone),
        partySize: row.party_size,
        notes: row.special_request ?? "",
      };
      setModifyInitial(initial);
      setModifyValues(initial);
      setModifyValidity({ canSave: false, reason: null, reasonKind: null });
    };
    void run();
    return () => {
      cancelled = true;
    };
    // refreshTick is intentional — bumping it re-runs the lookup.
  }, [slug, code, email, user, refreshTick]);

  const refreshDetails = useCallback(() => {
    setRefreshTick((t) => t + 1);
  }, []);

  const labels = useMemo(
    () => (reservation ? formatLocalDate(reservation.reserved_at, reservation.restaurant_timezone) : null),
    [reservation],
  );
  const isFinal = reservation && reservation.status && FINAL_STATUSES.has(reservation.status);

  // ── Pre-order edit derivations ─────────────────────────────────────
  // Modal availability mirrors BookingDetailsPage: status in
  // (pending, confirmed) AND > 2h before reservation. Server enforces
  // both — this is just to grey the button + show the tooltip.
  const cartEditLockedByTime = useMemo(() => {
    if (!reservation) return true;
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    return new Date(reservation.reserved_at).getTime() - Date.now() < TWO_HOURS_MS;
  }, [reservation]);
  const cartEditAllowedByStatus =
    reservation?.status === "pending" || reservation?.status === "confirmed";
  const canEditPreorder = Boolean(
    reservation && cartEditAllowedByStatus && !cartEditLockedByTime && !guestNeedsEmail,
  );
  // Source-of-truth pre-order = first row with is_preorder=true in the
  // enriched lookup blob. NULL when the lookup wasn't enriched (no email
  // forwarded for the logged-in fallback path).
  const preorderOrder = useMemo(
    () => details?.orders.find((o) => o.is_preorder) ?? null,
    [details],
  );
  const preorderInitialItems = useMemo<EditPreorderInitialItem[]>(() => {
    if (!preorderOrder) return [];
    return preorderOrder.items
      .filter((it) => it.menu_item_id !== null)
      .map((it) => ({
        menu_item_id: it.menu_item_id as string,
        name: it.name,
        unit_price: Number(it.unit_price) || 0,
        quantity: it.quantity,
      }));
  }, [preorderOrder]);
  const preorderAuth: EditPreorderAuth = useMemo(() => {
    if (isLoggedIn) return { kind: "logged_in" };
    // Guest path needs both code + email — caller proves identity.
    return { kind: "guest", confirmation_code: code, email: email ?? "" };
  }, [isLoggedIn, code, email]);

  const handleCancel = async () => {
    if (!reservation) return;
    setBusy(true);
    try {
      // Raw fetch (not client.functions.invoke) so we can read body.error on
      // non-2xx responses; functions.invoke wraps 4xx/5xx as generic
      // "non-2xx status code" and discards the JSON body.
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/cancel-reservation`, {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservation_id: reservation.id,
          confirmation_code: code,
          // Email forwarded from /find-reservation. Required by the edge
          // fn's guest path (it ignores this field for JWT-authed callers).
          ...(email ? { email } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        refund_total_cents?: number;
        refunds?: Array<{ ok?: boolean; amount_cents?: number }>;
      };
      if (!res.ok || body.error || body.ok !== true) {
        const friendly = toUserFacingEdgeError(res, body as unknown as Record<string, unknown>);
        setErrorMessage(friendly.message);
        console.error("[ManageBookingView.cancel]", friendly.code, friendly.technical ?? body);
        setMode("view");
        return;
      }
      // Drop cached availability so the freed-up slot reappears immediately
      // without waiting for realtime / DB cache TTL.
      invalidateAvailabilityCache(reservation.restaurant_id);
      const refundCents = typeof body.refund_total_cents === "number" ? body.refund_total_cents : 0;
      const refundAttempted = Array.isArray(body.refunds) && body.refunds.length > 0;
      const refundPending = refundAttempted && body.refunds!.some((r) => r?.ok === false);
      let message = "Your reservation has been cancelled. The restaurant has been notified.";
      if (refundCents > 0) {
        const dollars = (refundCents / 100).toFixed(2);
        message = refundPending
          ? `Your reservation has been cancelled. $${dollars} refunded; remaining refunds are processing — we'll email you once they complete.`
          : `Your reservation has been cancelled. $${dollars} has been refunded to your card.`;
      } else if (refundPending) {
        message = "Your reservation has been cancelled. Refunds are still processing — we'll email you once they complete.";
      }
      setDoneMessage(message);
      setMode("done");
    } catch (err) {
      // Prefer the edge fn's user-facing body.error (rethrown as
      // Error.message above) over the generic friendly fallback.
      const rawMessage = err instanceof Error ? err.message.trim() : "";
      const message =
        rawMessage && !/^(typeerror|failed to fetch|networkerror)/i.test(rawMessage)
          ? rawMessage
          : "Couldn't cancel the reservation. Try again.";
      setErrorMessage(message);
      console.error("[ManageBookingView.cancel]", err);
      setMode("view");
    } finally {
      setBusy(false);
    }
  };

  const handleModify = async () => {
    if (!reservation || !modifyValues || !modifyValidity.canSave) return;
    // The edge function expects 24-hour HH:MM (it concatenates `${date}T${time}:00Z`
    // into a Date constructor). The wheel commits a display string like "5:15pm".
    const normalisedTime = to24HourTime(modifyValues.time);
    if (!normalisedTime) {
      setErrorMessage("Pick a valid time and try again.");
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      // Raw fetch (not client.functions.invoke) so we can read body.error on
      // non-2xx responses. functions.invoke wraps any 4xx/5xx as a generic
      // "non-2xx status code" message and discards the JSON body.
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/modify-reservation`, {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservation_id: reservation.id,
          confirmation_code: code,
          // Same guest-path second factor as cancel-reservation. Ignored by
          // the edge fn for JWT-authed callers.
          ...(email ? { email } : {}),
          date: modifyValues.date,
          time: normalisedTime,
          party_size: modifyValues.partySize,
          special_request: modifyValues.notes,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        unavailable_reason?: string;
        deposit_adjustment?: {
          kind: "none" | "charged" | "refunded" | "failed";
          amount_cents?: number;
          reason?: string;
        };
      };
      if (!res.ok || body.error || body.ok !== true) {
        const friendly = toUserFacingEdgeError(res, body as unknown as Record<string, unknown>);
        setErrorMessage(friendly.message);
        console.error("[ManageBookingView.modify]", friendly.code, friendly.technical ?? body);
        return;
      }
      // Drop cached availability so the previous slot reappears + the new
      // one disappears for this device on the next view.
      invalidateAvailabilityCache(reservation.restaurant_id);
      // Surface deposit reconciliation outcome to the diner. The modify
      // edge fn already moved the slot; if the extra deposit charge
      // failed (e.g. card on file declined), the diner needs to know
      // — they shouldn't see a clean "success" if money is owed.
      const adj = body.deposit_adjustment;
      if (adj?.kind === "failed") {
        setDoneMessage(
          "Your slot was updated, but we couldn't charge the extra deposit on your card. " +
            "Please contact the restaurant or update your payment method to settle the difference."
        );
      } else if (adj?.kind === "charged" && typeof adj.amount_cents === "number") {
        const dollars = (adj.amount_cents / 100).toFixed(2);
        setDoneMessage(
          `Your reservation has been updated. We charged an extra $${dollars} deposit to cover the larger party.`
        );
      } else if (adj?.kind === "refunded" && typeof adj.amount_cents === "number") {
        const dollars = (adj.amount_cents / 100).toFixed(2);
        setDoneMessage(
          `Your reservation has been updated. We refunded $${dollars} since your party got smaller.`
        );
      } else {
        setDoneMessage("Your reservation has been updated. We've sent you a confirmation.");
      }
      setMode("done");
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't update the reservation. Try again.");
      setErrorMessage(friendly.message);
      console.error("[ManageBookingView.modify]", friendly.code, friendly.technical ?? err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <Button variant="ghost" size="sm" asChild className="mb-6 gap-1.5 text-text-secondary">
        <Link to={backHref}>
          <ArrowLeft className="size-4" />
          Back to {reservation?.restaurant_name ?? "restaurant"}
        </Link>
      </Button>

      {lookupState === "loading" && (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          Loading your reservation…
        </div>
      )}

      {lookupState === "error" && (
        <div className="space-y-3">
          <div className="rounded-2xl border border-danger/40 bg-danger/10 p-5 text-sm text-danger">
            We couldn't load this reservation: {errorMessage}
          </div>
          <p className="text-sm text-text-secondary">
            Can't find your booking?{" "}
            <Link to="/find-reservation" className="text-gold underline-offset-4 hover:underline">
              Try our reservation lookup →
            </Link>
          </p>
        </div>
      )}

      {lookupState === "missing" && (
        <div className="rounded-2xl border border-border bg-bg-surface p-5">
          <h1 className="font-serif text-2xl text-white">This booking can no longer be managed.</h1>
          <p className="mt-2 text-sm text-text-muted">
            The link may be invalid or the reservation may have already been cancelled or completed. If you believe this is a mistake, contact the restaurant directly.
          </p>
          <p className="mt-4 text-sm text-text-secondary">
            Can't find your booking?{" "}
            <Link to="/find-reservation" className="text-gold underline-offset-4 hover:underline">
              Try our reservation lookup →
            </Link>
          </p>
        </div>
      )}

      {lookupState === "found" && reservation && labels && (
        <div className="rounded-2xl border border-border bg-bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-serif text-2xl text-white">Manage your reservation</h1>
            {reservation.status && (
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em]",
                  isFinal ? "bg-bg-elevated text-text-muted" : "bg-gold/15 text-gold",
                )}
              >
                {reservation.status}
              </span>
            )}
          </div>

          <p className="text-sm text-text-secondary">{reservation.restaurant_name}</p>
          <p className="mt-1 font-serif text-xl text-white">{reservation.guest_full_name ?? "Guest"}</p>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <CalendarDays className="size-4 text-gold" />
              <div className="flex-1 text-text-secondary">{labels.date}</div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="size-4 text-gold" />
              <div className="flex-1 text-text-secondary">{labels.time}</div>
            </div>
            <div className="flex items-center gap-3">
              <Users className="size-4 text-gold" />
              <div className="flex-1 text-text-secondary">
                {reservation.party_size} {reservation.party_size === 1 ? "guest" : "guests"}
              </div>
            </div>
            {reservation.special_request ? (
              <div className="rounded-xl border border-border bg-bg-elevated p-3 text-text-secondary">
                <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Notes</span>
                <span className="mt-1 block">{reservation.special_request}</span>
              </div>
            ) : null}
          </dl>

          {/* 2026-05-28: enriched payment + contact detail card. Only
              renders when we have the lookup_reservation_details blob
              (i.e. email was forwarded). Guest-path message tells the
              diner that updates require contacting the restaurant
              since they have no account to edit. */}
          {details && (
            <BookingPaymentContactCard
              guestEmail={details.reservation.guest_email}
              guestPhone={details.reservation.guest_phone}
              contactUpdateHint="To update, contact the restaurant."
              paymentMethods={formatPaymentMethods([
                ...details.orders.map((o) => ({
                  key: `order-${o.id}`,
                  cardBrand: o.card_brand,
                  cardLast4: o.card_last4,
                  context: o.is_preorder ? "Pre-order" : "Order",
                })),
                ...details.deposits.map((d) => ({
                  key: `dep-${d.id}`,
                  cardBrand: d.card_brand,
                  cardLast4: d.card_last4,
                  context: d.payer_full_name ? `${d.payer_full_name} · deposit` : "Deposit",
                })),
              ])}
              depositTier={
                details.deposit_tier
                  ? {
                      amountPerPersonCents: details.deposit_tier.amount_per_person_cents,
                      partySize: details.reservation.party_size,
                      totalCents: details.deposit_tier.total_cents,
                    }
                  : null
              }
              splitTender={
                details.deposits.length > 1
                  ? details.deposits.map<BookingPaymentCardSplitTender>((d) => ({
                      id: d.id,
                      payerName: d.payer_full_name,
                      status: d.status,
                      amountCents: d.amount_cents,
                      cardBrand: d.card_brand,
                      cardLast4: d.card_last4,
                    }))
                  : []
              }
              appliedPromoCode={details.reservation.applied_promo_code}
              taxRate={details.restaurant.tax_rate}
              province={details.restaurant.province}
            />
          )}

          {/* Pre-order section — combines the existing item list with
              an Edit button. Surfaced from the enriched RPC when email
              was forwarded; logged-in fallback path (no email) doesn't
              get this section because `details` is null. Empty cart
              still shows the section so the diner can add a first
              pre-order via the same modal. */}
          {details && cartEditAllowedByStatus && (
            <div className="mt-6 rounded-2xl border border-border bg-bg-surface/60 p-4">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                Pre-order
              </h3>
              {preorderInitialItems.length > 0 ? (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {preorderInitialItems.map((it) => (
                    <li
                      key={it.menu_item_id}
                      className="flex justify-between text-text-secondary"
                    >
                      <span>
                        {it.quantity} × {it.name}
                      </span>
                      <span className="text-white">
                        ${(it.unit_price * it.quantity).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-text-secondary">
                  No pre-order on this booking yet. Add dishes now so the
                  kitchen has time to prep before you arrive.
                </p>
              )}
              <div className="mt-4">
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-block">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!canEditPreorder}
                          onClick={() => {
                            // Mutual exclusion with slot-modify panel.
                            if (mode === "modify") setMode("view");
                            setPreorderOpen(true);
                          }}
                          className="gap-2"
                        >
                          <PencilLine className="size-3.5" />
                          {preorderInitialItems.length > 0
                            ? "Edit pre-order"
                            : "Add pre-order"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {!canEditPreorder && (
                      <TooltipContent side="top">
                        Pre-order locks 2 hours before your reservation
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
          )}

          {/* 2026-05-27: Edit pre-order modal. Mounted only when the
              enriched lookup gave us a restaurant.id. Pre-order flow
              uses guest auth for the logged-out path. */}
          {details?.restaurant.id && (
            <EditPreorderModal
              open={preorderOpen}
              onOpenChange={setPreorderOpen}
              reservationId={reservation.id}
              restaurantId={details.restaurant.id}
              restaurantProvince={details.restaurant.province}
              restaurantTaxRate={details.restaurant.tax_rate}
              initialItems={preorderInitialItems}
              initialPromoCode={details.reservation.applied_promo_code}
              auth={preorderAuth}
              onSaved={(summary) => {
                invalidateAvailabilityCache(reservation.restaurant_id);
                refreshDetails();
                if (summary.requiredPayment) {
                  setDoneMessage("Pre-order updated and charged.");
                } else if (summary.refundedCents && summary.refundedCents > 0) {
                  setDoneMessage(
                    `Pre-order updated. $${(summary.refundedCents / 100).toFixed(2)} refunded to your card.`,
                  );
                } else {
                  setDoneMessage("Pre-order updated.");
                }
                setMode("done");
              }}
            />
          )}

          {errorMessage && (
            <div className="mt-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              {errorMessage}
            </div>
          )}

          {mode === "done" && (
            <div className="mt-5 rounded-xl border border-success/40 bg-success/10 p-4 text-sm text-success">
              {doneMessage}
            </div>
          )}

          {!isFinal && mode === "view" && guestNeedsEmail && (
            <div className="mt-6 rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm text-warning">
              <p className="font-semibold">Verify your email to manage this booking.</p>
              <p className="mt-1 text-warning/90">
                For your security, modifying or cancelling a reservation now
                requires the email on the booking. Please use the
                find-my-reservation page to re-enter it.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => navigate("/find-reservation")}
              >
                Go to find-my-reservation
              </Button>
            </div>
          )}

          {!isFinal && mode === "view" && !guestNeedsEmail && (
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  // Mutual exclusion: don't leave the pre-order modal
                  // open behind the modify panel.
                  setPreorderOpen(false);
                  setMode("modify");
                }}
                disabled={busy}
              >
                Modify booking
              </Button>
              <Button
                variant="outline"
                onClick={() => setMode("confirmCancel")}
                disabled={busy}
              >
                Cancel booking
              </Button>
            </div>
          )}

          {reservation?.deposit_status === "charged" &&
            reservation?.status === "completed" && (
              <div className="mt-6 border-t border-border pt-4">
                <p className="text-xs text-text-muted">
                  Believe you were charged in error? Submit a refund request and
                  our team will review within 5 business days.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setRefundDialogOpen(true)}
                  disabled={busy}
                >
                  Request a refund
                </Button>
              </div>
            )}

          {reservation && (
            <RefundRequestDialog
              open={refundDialogOpen}
              onOpenChange={setRefundDialogOpen}
              reservationId={reservation.id}
            />
          )}

          <Dialog
            open={mode === "confirmCancel"}
            onOpenChange={(open) => {
              if (!open && !busy) setMode("view");
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Cancel this reservation?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-text-secondary">
                Cancelling will release your table and notify the restaurant.
                Any deposit or pre-order you've paid will be refunded to the
                card you used. This can't be undone.
              </p>
              {reservation?.deposit_status === "charged" ? (
                <p className="text-xs text-warning">
                  If the deposit was charged, the refund is issued to your
                  original card and will appear on your statement within 5
                  business days. Contact{" "}
                  <a
                    href="mailto:help@cenaiva.com"
                    className="text-warning underline-offset-2 hover:underline"
                  >
                    help@cenaiva.com
                  </a>{" "}
                  if anything looks wrong.
                </p>
              ) : (
                <p className="text-xs text-text-muted">
                  Refunds typically land on your card within 5–10 business
                  days. Contact{" "}
                  <a
                    href="mailto:help@cenaiva.com"
                    className="text-gold underline-offset-2 hover:underline"
                  >
                    help@cenaiva.com
                  </a>{" "}
                  if anything looks wrong.
                </p>
              )}
              <DialogFooter className="gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMode("view")}
                  disabled={busy}
                >
                  Keep booking
                </Button>
                <Button
                  type="button"
                  onClick={handleCancel}
                  disabled={busy}
                  className="bg-danger text-white hover:bg-danger/90"
                >
                  {busy ? "Cancelling…" : "Yes, cancel"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {mode === "modify" && modifyInitial && (
            <div className="mt-6 space-y-4">
              <ModifyBookingFields
                key={`${reservation.id}-modify`}
                restaurantId={reservation.restaurant_id}
                restaurantTimezone={reservation.restaurant_timezone}
                reservationId={reservation.id}
                userProfileId={null}
                initial={modifyInitial}
                onChange={setModifyValues}
                onValidityChange={setModifyValidity}
              />
              {(() => {
                const pickedTime = modifyValues?.time
                  ? formatCompactTimeLabel(modifyValues.time)
                  : null;
                const ctaLabel = busy
                  ? "Saving…"
                  : modifyValidity.reasonKind === "blocking" && modifyValidity.reason
                    ? modifyValidity.reason
                    : modifyValidity.reasonKind === "neutral" && modifyValidity.reason
                      ? modifyValidity.reason
                      : modifyValidity.canSave && pickedTime
                        ? `Confirm ${pickedTime} changes`
                        : "Pick new details to continue";
                return (
                  <div className="space-y-2">
                    <Button
                      onClick={handleModify}
                      disabled={busy || !modifyValidity.canSave}
                      className="h-14 w-full rounded-xl text-base font-semibold"
                    >
                      {ctaLabel}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setMode("view")}
                      disabled={busy}
                      className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
                    >
                      Keep current booking
                    </Button>
                  </div>
                );
              })()}
            </div>
          )}

          {mode === "done" && (
            <div className="mt-5">
              <Button asChild variant="outline">
                <Link to={backHref}>Back to {reservation.restaurant_name ?? "restaurant"}</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft,
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  MapPin,
  PencilLine,
  Phone,
  Tag,
  Ticket,
  UtensilsCrossed,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { CustomerNav } from "@/components/customer/CustomerNav";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ModifyBookingFields,
  type ModifyBookingValidity,
  type ModifyBookingValues,
} from "@/components/booking/ModifyBookingFields";
import {
  BookingPaymentContactCard,
  type BookingPaymentCardSplitTender,
} from "@/components/customer/BookingPaymentContactCard";
import { formatPaymentMethods } from "@/lib/booking/paymentMethods";
import {
  EditPreorderModal,
  type EditPreorderInitialItem,
} from "@/components/customer/EditPreorderModal";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { SplitTenderPaymentForm } from "@/components/booking/SplitTenderPaymentForm";
import { SPLIT_TENDER_ENABLED } from "@/lib/featureFlags";
import { invalidateAvailabilityCache } from "@/hooks/useAvailability";
import { type MyReservationRow } from "@/hooks/useMyReservations";
import { useReservationById } from "@/hooks/useReservationById";
import { useReservationPayments } from "@/hooks/useReservationPayments";
import { useUser } from "@/hooks/useUser";
import { useErrorToast } from "@/lib/errors";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import {
  reservationDisplayStatus,
  reservationDisplayStatusKey,
  type ReservationDisplayStatus,
} from "@/lib/reservations/displayStatus";
import { cn } from "@/lib/utils";
import { dateInTz, formatCompactTimeLabel, formatCompactTimeLabelInTz, timeInTz, to24HourTime } from "@/lib/utils/time";

function statusFor(row: MyReservationRow): ReservationDisplayStatus {
  return reservationDisplayStatus(row);
}

function statusClass(status: ReservationDisplayStatus): string {
  const classes: Record<ReservationDisplayStatus, string> = {
    upcoming: "border-success/30 bg-success/10 text-success",
    current: "border-gold/30 bg-gold/10 text-gold",
    past: "border-border bg-bg-elevated text-text-secondary",
    cancelled: "border-danger/30 bg-danger/10 text-danger",
  };
  return classes[status];
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-bg-surface/60 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
        <Icon className="size-4" />
      </span>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          {label}
        </p>
        <p className="mt-1 text-sm font-medium text-white">{value}</p>
      </div>
    </div>
  );
}

type CancelRefundReport = {
  kind: "preorder" | "deposit";
  ok: boolean;
  amount_cents: number;
  error?: string;
};

type CancelResult = {
  refund_total_cents: number;
  refunds: CancelRefundReport[];
};

async function cancelReservation(reservationId: string): Promise<CancelResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }

  // Raw fetch (not client.functions.invoke) so we can read body.error on
  // non-2xx responses. functions.invoke wraps any 4xx/5xx as a generic
  // "Edge Function returned a non-2xx status code" message and discards the
  // JSON body the edge function uses to explain why.
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/cancel-reservation`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      // 2026-05-28: idempotency key. Cancel is naturally idempotent at the
      // row level (server early-returns when status is already cancelled),
      // but the explicit header documents the intent and lets future
      // server-side dedup hook off it.
      "x-idempotency-key": `cancel_${reservationId}`,
    },
    body: JSON.stringify({ reservation_id: reservationId }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    refund_total_cents?: number;
    refunds?: CancelRefundReport[];
  };
  if (!res.ok || body.error || body.ok !== true) {
    throw new Error(body.error ?? `Could not cancel reservation (${res.status}).`);
  }
  return {
    refund_total_cents:
      typeof body.refund_total_cents === "number" ? body.refund_total_cents : 0,
    refunds: Array.isArray(body.refunds) ? body.refunds : [],
  };
}

function PaymentStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const variants: Record<string, { label: string; className: string }> = {
    paid: {
      label: "Paid",
      className: "border-success/30 bg-success/10 text-success",
    },
    refunded: {
      label: "Refunded",
      className: "border-border bg-bg-elevated text-text-secondary",
    },
    pending: {
      label: "Pending",
      className: "border-gold/30 bg-gold/10 text-gold",
    },
    failed: {
      label: "Failed",
      className: "border-danger/30 bg-danger/10 text-danger",
    },
  };
  const v = variants[normalized] ?? {
    label: normalized.charAt(0).toUpperCase() + normalized.slice(1),
    className: "border-border bg-bg-elevated text-text-secondary",
  };
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
        v.className,
      )}
    >
      {v.label}
    </span>
  );
}

type ModifyDepositAdjustment =
  | { kind: "none" }
  | { kind: "charged"; amount_cents: number; payment_intent_id: string | null }
  | { kind: "refunded"; amount_cents: number; payment_intent_id: string | null }
  | { kind: "failed"; reason: string };

type ModifyResult =
  | { kind: "applied"; deposit_adjustment: ModifyDepositAdjustment }
  | {
      kind: "requires_payment";
      // 2026-05-28 (PR-K): array shape to support split-tender. The legacy
      // single-payer flow degenerates to a 1-element array internally.
      deposit_payment_row_ids: string[];
      is_split_tender: boolean;
      split_payers: Array<{
        row_id: string;
        amount_cents: number;
        payer_full_name: string | null;
        payer_email: string | null;
      }>;
      delta_cents: number;
      restaurant_id: string;
      reservation_id: string;
      pending_date: string;
      pending_time: string;
      pending_party_size: number;
      pending_special_request: string | null;
    };

async function modifyReservation(
  reservationId: string,
  payload: {
    date: string;
    time: string;
    partySize: number;
    specialRequest: string;
  },
): Promise<ModifyResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }

  // The edge function builds a UTC ISO via `new Date("${date}T${time}:00Z")`
  // which only accepts 24-hour HH:MM. The wheel commits the slot's display
  // string ("5:15pm") so we need to normalise here before sending.
  const normalisedTime = to24HourTime(payload.time);
  if (!normalisedTime) {
    throw new Error("Pick a valid time and try again.");
  }

  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/modify-reservation`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      // 2026-05-28: idempotency key keyed on target slot. Prevents
      // browser network retries from running the slot-modify pipeline
      // twice (the existing confirm-modify-payment slot-aware guard
      // is the inner safety net).
      "x-idempotency-key": `modify_${reservationId}_${payload.date}_${normalisedTime}_${payload.partySize}`,
    },
    body: JSON.stringify({
      reservation_id: reservationId,
      date: payload.date,
      time: normalisedTime,
      party_size: payload.partySize,
      special_request: payload.specialRequest,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    unavailable_reason?: string;
    deposit_adjustment?: ModifyDepositAdjustment;
    delta_cents?: number;
    requires_payment?: boolean;
    // 2026-05-28 (PR-K): server now returns BOTH single + array shapes.
    deposit_payment_row_id?: string;
    deposit_payment_row_ids?: string[];
    is_split_tender?: boolean;
    split_payers?: Array<{
      row_id: string;
      amount_cents: number;
      payer_full_name: string | null;
      payer_email: string | null;
    }>;
    restaurant_id?: string;
    reservation_id?: string;
    pending_date?: string;
    pending_time?: string;
    pending_party_size?: number;
    pending_special_request?: string | null;
  };

  // 2026-05-27: the deposit-delta-charge flow now redirects to a payment
  // step instead of trying to charge a saved card behind the scenes. When
  // the response carries requires_payment=true the caller mounts Stripe
  // Elements with the returned client params; on payment success the
  // confirmModifyPayment helper finalizes the slot change.
  const resolvedRowIds = body.deposit_payment_row_ids
    ?? (body.deposit_payment_row_id ? [body.deposit_payment_row_id] : null);
  if (
    res.ok &&
    body.requires_payment === true &&
    resolvedRowIds &&
    resolvedRowIds.length > 0 &&
    typeof body.delta_cents === "number" &&
    body.restaurant_id &&
    body.reservation_id &&
    body.pending_date &&
    body.pending_time &&
    typeof body.pending_party_size === "number"
  ) {
    return {
      kind: "requires_payment",
      deposit_payment_row_ids: resolvedRowIds,
      is_split_tender: body.is_split_tender === true || resolvedRowIds.length >= 2,
      split_payers: body.split_payers ?? resolvedRowIds.map((id) => ({
        row_id: id,
        amount_cents: body.delta_cents ?? 0,
        payer_full_name: null,
        payer_email: null,
      })),
      delta_cents: body.delta_cents,
      restaurant_id: body.restaurant_id,
      reservation_id: body.reservation_id,
      pending_date: body.pending_date,
      pending_time: body.pending_time,
      pending_party_size: body.pending_party_size,
      pending_special_request: body.pending_special_request ?? null,
    };
  }

  if (!res.ok || body.error || body.ok !== true) {
    throw new Error(body.error ?? `Could not modify reservation (${res.status}).`);
  }
  return {
    kind: "applied",
    deposit_adjustment: body.deposit_adjustment ?? { kind: "none" },
  };
}

type ConfirmModifyResult = {
  reservation_id: string;
  reserved_at: string;
  party_size: number;
  deposit_adjustment: ModifyDepositAdjustment;
};

async function confirmModifyPayment(payload: {
  reservationId: string;
  // 2026-05-28 (PR-K): pass arrays for split-tender; single-payer uses
  // a 1-element array. Server normalizes both shapes via the schema.
  depositPaymentRowIds: string[];
  paymentIntentIds: string[];
  date: string;
  time: string;
  partySize: number;
  specialRequest: string;
}): Promise<ConfirmModifyResult> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }
  const normalisedTime = to24HourTime(payload.time);
  if (!normalisedTime) throw new Error("Internal: invalid time format.");
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  const isMulti = payload.depositPaymentRowIds.length > 1;
  const idemKey = isMulti
    ? `confirm_modify_${payload.reservationId}_multi_${payload.paymentIntentIds.join(",")}`
    : `confirm_modify_${payload.reservationId}_${payload.depositPaymentRowIds[0]}_${payload.paymentIntentIds[0]}`;
  const res = await fetch(
    `${getSupabaseProjectUrl()}/functions/v1/confirm-modify-payment`,
    {
      method: "POST",
      headers: {
        apikey: getSupabaseAnonKey(),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
        // 2026-05-28: idempotency key keyed on (reservation, deposit rows,
        // PIs). confirm-modify-payment already has slot-aware idempotency
        // server-side; this header documents intent + provides a stable
        // key for any future dedup table.
        "x-idempotency-key": idemKey,
      },
      body: JSON.stringify({
        reservation_id: payload.reservationId,
        ...(isMulti
          ? {
              deposit_payment_row_ids: payload.depositPaymentRowIds,
              payment_intent_ids: payload.paymentIntentIds,
            }
          : {
              deposit_payment_row_id: payload.depositPaymentRowIds[0],
              payment_intent_id: payload.paymentIntentIds[0],
            }),
        date: payload.date,
        time: normalisedTime,
        party_size: payload.partySize,
        special_request: payload.specialRequest || undefined,
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    refunded?: boolean;
    reservation_id?: string;
    reserved_at?: string;
    party_size?: number;
    deposit_adjustment?: ModifyDepositAdjustment;
  };
  if (!res.ok || body.error || body.ok !== true) {
    if (body.refunded) {
      throw new Error(
        body.error ?? "That time was just taken. We refunded your payment.",
      );
    }
    throw new Error(body.error ?? `Could not finalize modification (${res.status}).`);
  }
  return {
    reservation_id: body.reservation_id ?? payload.reservationId,
    reserved_at: body.reserved_at ?? "",
    party_size: body.party_size ?? payload.partySize,
    deposit_adjustment: body.deposit_adjustment ?? { kind: "none" },
  };
}

export default function BookingDetailsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { reservationId } = useParams<{ reservationId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    reservation: reservationRow,
    loading,
    refresh,
  } = useReservationById(reservationId ?? null);
  const { profile } = useUser();
  const { errorToast } = useErrorToast();
  const { data: paymentData, refresh: refreshPayments } = useReservationPayments(
    reservationId ?? null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [modifyOpen, setModifyOpen] = useState(false);
  const autoOpenedFromUrl = useRef(false);
  const [modifying, setModifying] = useState(false);
  const [modifyInitial, setModifyInitial] = useState<ModifyBookingValues | null>(null);
  const [modifyValues, setModifyValues] = useState<ModifyBookingValues | null>(null);
  // 2026-05-27: pending modification awaiting payment delta. When the
  // edge fn returns requires_payment, we stash the new params here and
  // open the payment dialog; on Stripe success we call
  // confirm-modify-payment to finalize.
  const [pendingPayment, setPendingPayment] = useState<{
    reservationId: string;
    // 2026-05-28 (PR-K): arrays for split-tender; single-payer is length 1.
    depositPaymentRowIds: string[];
    isSplitTender: boolean;
    splitPayers: Array<{
      row_id: string;
      amount_cents: number;
      payer_full_name: string | null;
      payer_email: string | null;
    }>;
    deltaCents: number;
    restaurantId: string;
    date: string;
    time: string;
    partySize: number;
    specialRequest: string;
  } | null>(null);
  const [finalizingPayment, setFinalizingPayment] = useState(false);
  const [modifyValidity, setModifyValidity] = useState<ModifyBookingValidity>({
    canSave: false,
    reason: null,
    reasonKind: null,
  });

  // 2026-05-27: Edit-pre-order modal. Mutually exclusive with the
  // slot-modify dialog and the deposit-delta payment dialog — opening one
  // closes the others. Tracked as a single discriminated state so two
  // modals can't both be on screen at once.
  const [preorderOpen, setPreorderOpen] = useState(false);

  const reservation: MyReservationRow | null = reservationRow;

  const status = reservation ? statusFor(reservation) : null;
  const reservedAt = useMemo(
    () => reservation ? new Date(reservation.reserved_at) : null,
    [reservation],
  );
  const canCancel = Boolean(reservation && (status === "upcoming" || status === "current"));
  const canModify = canCancel;
  const restaurantName = reservation?.restaurant?.name ?? "Restaurant";
  const cuisineLine = [reservation?.restaurant?.cuisine_type, reservation?.restaurant?.city]
    .filter(Boolean)
    .join(" · ");

  const buildInitialModifyValues = (
    row: MyReservationRow,
    at: Date,
  ): ModifyBookingValues => {
    const tz = row.restaurant?.timezone ?? null;
    return {
      date: dateInTz(at, tz),
      time: timeInTz(at, tz),
      partySize: row.party_size,
      notes: row.special_request ?? "",
    };
  };

  const openModifyDialog = () => {
    if (!reservation || !reservedAt || !canModify) return;
    const initial = buildInitialModifyValues(reservation, reservedAt);
    setModifyInitial(initial);
    setModifyValues(initial);
    setModifyValidity({ canSave: false, reason: null, reasonKind: null });
    // Mutual exclusion: never let the preorder modal stay open behind the
    // modify dialog.
    setPreorderOpen(false);
    setModifyOpen(true);
  };

  // ── Pre-order section gating + snapshot ────────────────────────────
  // Cart edits lock 2 hours before the reservation (server enforces too).
  const cartEditLockedByTime = useMemo(() => {
    if (!reservedAt) return true;
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    return reservedAt.getTime() - Date.now() < TWO_HOURS_MS;
  }, [reservedAt]);
  const reservationStatus = reservation?.status ?? null;
  const cartEditAllowedByStatus =
    reservationStatus === "pending" || reservationStatus === "confirmed";
  const canEditPreorder = Boolean(
    reservation && cartEditAllowedByStatus && !cartEditLockedByTime,
  );

  // First preorder = source of truth for the editable cart. There's
  // normally one preorder per reservation; if multiple exist (rare,
  // legacy split-cart) we edit the first.
  const preorderOrder = useMemo(() => {
    if (!paymentData) return null;
    return paymentData.orders.find((o) => o.is_preorder) ?? null;
  }, [paymentData]);
  const preorderInitialItems = useMemo<EditPreorderInitialItem[]>(() => {
    if (!preorderOrder) return [];
    return preorderOrder.order_items
      .filter((it) => it.menu_item_id !== null)
      .map((it) => ({
        menu_item_id: it.menu_item_id as string,
        name: it.name,
        unit_price: Number(it.unit_price) || 0,
        quantity: it.quantity,
      }));
  }, [preorderOrder]);
  const preorderSubtotalDollars = useMemo(
    () =>
      preorderOrder
        ? preorderOrder.order_items.reduce(
            (s, it) => s + Number(it.unit_price) * it.quantity,
            0,
          )
        : 0,
    [preorderOrder],
  );
  const preorderTaxRate = paymentData?.restaurant?.tax_rate ?? null;
  const preorderTaxDollars =
    preorderTaxRate != null ? preorderSubtotalDollars * preorderTaxRate : 0;
  const preorderTotalDollars = preorderSubtotalDollars + preorderTaxDollars;

  const openPreorderDialog = () => {
    if (!canEditPreorder) return;
    // Mutual exclusion: close slot-modify + delta-payment dialogs.
    setModifyOpen(false);
    setPendingPayment(null);
    setPreorderOpen(true);
  };

  useEffect(() => {
    if (autoOpenedFromUrl.current) return;
    if (searchParams.get("modify") !== "1" || !reservation || !reservedAt || !canModify) {
      return;
    }
    autoOpenedFromUrl.current = true;
    const initial = buildInitialModifyValues(reservation, reservedAt);
    setModifyInitial(initial);
    setModifyValues(initial);
    setModifyValidity({ canSave: false, reason: null, reasonKind: null });
    setModifyOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("modify");
        return next;
      },
      { replace: true },
    );
  }, [canModify, reservation, reservedAt, searchParams, setSearchParams]);

  const handleCancel = async () => {
    if (!reservation || !canCancel || cancelling) return;
    setCancelling(true);
    try {
      const result = await cancelReservation(reservation.id);
      // The edge fn returned — DB is consistent. Close the dialog and toast
      // RIGHT NOW. Refetches + cache invalidation run in the background so
      // the user isn't left staring at "Cancelling…" while the data layer
      // catches up.
      setCancelConfirmOpen(false);
      setCancelling(false);
      const failedRefunds = result.refunds.filter((r) => !r.ok);
      if (result.refund_total_cents > 0 && failedRefunds.length === 0) {
        toast.success(
          `Reservation cancelled. $${(result.refund_total_cents / 100).toFixed(2)} refunded to your card.`,
        );
      } else if (failedRefunds.length > 0) {
        toast.warning(
          "Reservation cancelled. Some refunds are still processing — we'll email you once they complete.",
        );
      } else {
        toast.success("Reservation cancelled.");
      }
      void refresh();
      void refreshPayments();
      if (reservation.restaurant?.id) invalidateAvailabilityCache(reservation.restaurant.id);
    } catch (error) {
      // Surface the edge fn's body.error directly — see BookingsPage.cancel.
      const rawMessage = error instanceof Error ? error.message.trim() : "";
      const message =
        rawMessage && !/^(typeerror|failed to fetch|networkerror)/i.test(rawMessage)
          ? rawMessage
          : "Couldn't cancel that reservation. Try again.";
      toast.error(message);
      console.error("[BookingDetailsPage.cancel]", error);
      setCancelling(false);
    }
  };

  const handleModify = async () => {
    if (!reservation || !canModify || modifying || !modifyValues || !modifyValidity.canSave) {
      return;
    }

    setModifying(true);
    try {
      const result = await modifyReservation(reservation.id, {
        date: modifyValues.date,
        time: modifyValues.time,
        partySize: modifyValues.partySize,
        specialRequest: modifyValues.notes.trim(),
      });

      // 2026-05-27: the edge fn signals a deposit-delta payment is needed.
      // Stash the pending change + open the payment dialog. The actual
      // modification doesn't apply until the diner pays and we call
      // confirm-modify-payment.
      if (result.kind === "requires_payment") {
        setPendingPayment({
          reservationId: result.reservation_id,
          depositPaymentRowIds: result.deposit_payment_row_ids,
          isSplitTender: result.is_split_tender,
          splitPayers: result.split_payers,
          deltaCents: result.delta_cents,
          restaurantId: result.restaurant_id,
          date: result.pending_date,
          time: result.pending_time,
          partySize: result.pending_party_size,
          specialRequest: result.pending_special_request ?? "",
        });
        setModifyOpen(false);
        return;
      }

      await refresh();
      void refreshPayments();
      if (reservation.restaurant?.id) invalidateAvailabilityCache(reservation.restaurant.id);
      setModifyOpen(false);

      const adj = result.deposit_adjustment;
      if (adj.kind === "refunded") {
        toast.success(
          `Reservation modified. $${(adj.amount_cents / 100).toFixed(2)} refunded to your card.`,
        );
      } else if (adj.kind === "failed") {
        toast.warning(
          "Reservation modified, but the deposit refund didn't go through. The restaurant will reach out.",
        );
      } else {
        toast.success("Reservation modified.");
      }
    } catch (error) {
      errorToast(error, {
        fallback: "Couldn't update that reservation. Try again.",
        logTag: "[BookingDetailsPage.modify]",
      });
    } finally {
      setModifying(false);
    }
  };

  // 2026-05-28 (PR-K): accepts either a single PI id (solo StripePaymentForm
  // callback shape) OR an array of PI ids (split-tender path harvests them
  // from the reservation's RDP rows after onAllPaid fires).
  const handleModifyPaymentPaid = async (paymentIntentIds: string | string[]) => {
    if (!pendingPayment || finalizingPayment) return;
    const piIds = Array.isArray(paymentIntentIds)
      ? paymentIntentIds
      : [paymentIntentIds];
    if (piIds.length !== pendingPayment.depositPaymentRowIds.length) {
      errorToast(
        new Error(
          `Payment count mismatch (got ${piIds.length}, expected ${pendingPayment.depositPaymentRowIds.length}).`,
        ),
        { fallback: "Couldn't finalize the modification.", logTag: "[BookingDetailsPage.confirmModifyPayment]" },
      );
      return;
    }
    setFinalizingPayment(true);
    try {
      await confirmModifyPayment({
        reservationId: pendingPayment.reservationId,
        depositPaymentRowIds: pendingPayment.depositPaymentRowIds,
        paymentIntentIds: piIds,
        date: pendingPayment.date,
        time: pendingPayment.time,
        partySize: pendingPayment.partySize,
        specialRequest: pendingPayment.specialRequest,
      });
      await refresh();
      void refreshPayments();
      if (reservation?.restaurant?.id) invalidateAvailabilityCache(reservation.restaurant.id);
      setPendingPayment(null);
      toast.success(
        `Reservation modified. $${(pendingPayment.deltaCents / 100).toFixed(2)} charged to complete the change.`,
      );
    } catch (error) {
      // confirm-modify-payment will have auto-refunded the diner if the
      // slot was taken between payment + confirm. Surface clearly.
      errorToast(error, {
        fallback: "Couldn't finalize the modification. Try again.",
        logTag: "[BookingDetailsPage.confirmModifyPayment]",
      });
      setPendingPayment(null);
    } finally {
      setFinalizingPayment(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>
          <CustomerNav />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1040px] px-5 py-10 lg:px-8 lg:py-12">
        <button
          type="button"
          onClick={() => navigate("/bookings")}
          className="inline-flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back to bookings
        </button>

        {loading && (
          <div className="mt-8 rounded-3xl border border-border bg-bg-surface/50 p-8 text-sm text-text-muted">
            Loading reservation details...
          </div>
        )}

        {!loading && !reservation && (
          <div className="mt-8 rounded-3xl border border-border bg-bg-surface/50 p-8">
            <p className="font-serif text-3xl text-white">Reservation not found</p>
            <p className="mt-2 text-sm text-text-secondary">
              This booking could not be found for your account.
            </p>
            <Button asChild className="mt-6 h-10 rounded-md font-semibold">
              <Link to="/bookings">View bookings</Link>
            </Button>
          </div>
        )}

        {reservation && reservedAt && status && (
          <div className="mt-8 overflow-hidden rounded-3xl border border-border bg-bg-surface shadow-2xl shadow-black/30">
            <div className="relative flex min-h-[280px] items-end overflow-hidden bg-bg-elevated p-6 sm:p-8">
              {reservation.restaurant?.cover_photo_url ? (
                <img
                  src={reservation.restaurant.cover_photo_url}
                  alt={`${restaurantName} cover`}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-gold/15 via-bg-elevated to-bg-base" />
              )}
              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/45 to-bg-base" />
              <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-3 py-1 text-xs font-medium",
                      statusClass(status),
                    )}
                  >
                    {t(reservationDisplayStatusKey(status))}
                  </span>
                  <p className="mt-4 font-serif text-3xl leading-tight text-white sm:text-5xl">
                    {restaurantName}
                  </p>
                  {cuisineLine && (
                    <p className="mt-2 text-sm uppercase tracking-[0.18em] text-text-secondary">
                      {cuisineLine}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="grid gap-8 p-6 lg:grid-cols-[1fr_280px] lg:p-8">
              <section>
                <h1 className="font-serif text-3xl text-white">Reservation details</h1>
                <p className="mt-2 max-w-2xl text-sm text-text-secondary">
                  This page shows your booking information only. To make a new reservation, use
                  View restaurant.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <DetailRow
                    icon={CalendarDays}
                    label="Date"
                    value={new Intl.DateTimeFormat("en-US", {
                      timeZone: reservation.restaurant?.timezone ?? undefined,
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }).format(reservedAt)}
                  />
                  <DetailRow
                    icon={Clock}
                    label="Time"
                    value={formatCompactTimeLabelInTz(reservedAt, reservation.restaurant?.timezone ?? null)}
                  />
                  <DetailRow
                    icon={Users}
                    label="Guests"
                    value={`${reservation.party_size} guests`}
                  />
                  <DetailRow
                    icon={Tag}
                    label="Confirmation"
                    value={reservation.confirmation_code ?? "Not issued yet"}
                  />
                  {reservation.event && (
                    <DetailRow
                      icon={Ticket}
                      label="Event"
                      value={
                        reservation.event.price_per_person != null
                          ? `${reservation.event.name ?? "Event"} · $${Number(reservation.event.price_per_person).toFixed(0)}/person`
                          : reservation.event.name ?? "Event"
                      }
                    />
                  )}
                  {reservation.promotion && (
                    <DetailRow
                      icon={BadgePercent}
                      label="Promotion"
                      value={
                        reservation.promotion.promo_code
                          ? `${reservation.promotion.title ?? "Promotion"} (${reservation.promotion.promo_code})`
                          : reservation.promotion.title ?? "Promotion"
                      }
                    />
                  )}
                  {!reservation.promotion && reservation.applied_promo_code && (
                    <DetailRow
                      icon={BadgePercent}
                      label="Promo code"
                      value={reservation.applied_promo_code}
                    />
                  )}
                  {reservation.special_request && (
                    <DetailRow
                      icon={PencilLine}
                      label="Notes"
                      value={reservation.special_request}
                    />
                  )}
                  {reservation.restaurant?.address && (
                    <DetailRow icon={MapPin} label="Address" value={reservation.restaurant.address} />
                  )}
                  {reservation.restaurant?.phone && (
                    <DetailRow icon={Phone} label="Phone" value={reservation.restaurant.phone} />
                  )}
                </div>

                {/* 2026-05-28: enriched "Payment & contact details" card.
                    Renders for every reservation (not just paid ones) so
                    diners see their contact info + cancellation deadline
                    + tax rate even when there's no deposit/pre-order. */}
                {paymentData && (
                  <BookingPaymentContactCard
                    guestEmail={
                      paymentData.reservation?.guest_email ??
                      profile?.email ??
                      null
                    }
                    guestPhone={
                      paymentData.reservation?.guest_phone ??
                      profile?.phone ??
                      null
                    }
                    contactUpdateHint="To update, edit your profile in Account."
                    paymentMethods={formatPaymentMethods([
                      ...paymentData.orders.map((o) => ({
                        key: `order-${o.id}`,
                        cardBrand: o.card_brand,
                        cardLast4: o.card_last4,
                        context: o.is_preorder ? "Pre-order" : "Order",
                      })),
                      ...paymentData.deposits.map((d) => ({
                        key: `dep-${d.id}`,
                        cardBrand: d.card_brand,
                        cardLast4: d.card_last4,
                        context: d.payer_full_name
                          ? `${d.payer_full_name} · deposit`
                          : "Deposit",
                      })),
                    ])}
                    depositTier={(() => {
                      // Reconstruct per-person × party = total from the
                      // stored deposit_amount_cents. The original tier
                      // breakdown isn't kept on the reservation row, but
                      // this is mathematically equivalent for display.
                      const total =
                        paymentData.reservation?.deposit_amount_cents ?? 0;
                      const party = paymentData.reservation?.party_size ?? 0;
                      if (total <= 0 || party <= 0) return null;
                      return {
                        amountPerPersonCents: Math.round(total / party),
                        partySize: party,
                        totalCents: total,
                      };
                    })()}
                    splitTender={
                      paymentData.deposits.length > 1
                        ? paymentData.deposits.map<BookingPaymentCardSplitTender>(
                            (d) => ({
                              id: d.id,
                              payerName: d.payer_full_name,
                              status: d.status,
                              amountCents: d.amount_cents,
                              cardBrand: d.card_brand,
                              cardLast4: d.card_last4,
                            }),
                          )
                        : []
                    }
                    appliedPromoCode={
                      paymentData.reservation?.applied_promo_code ??
                      reservation.applied_promo_code ??
                      null
                    }
                    taxRate={paymentData.restaurant?.tax_rate ?? null}
                    province={paymentData.restaurant?.province ?? null}
                  />
                )}

                {/* 2026-05-27: Pre-order section. Always visible for
                    pending/confirmed reservations — even when there's no
                    pre-order yet, the diner can use the "Add pre-order"
                    button to attach one. Edit/Add both lock 2h before
                    the reservation (server enforces too). */}
                {paymentData && cartEditAllowedByStatus && (
                  <div className="mt-10">
                    <div className="flex items-center gap-2">
                      <CreditCard className="size-4 text-gold" />
                      <h2 className="font-serif text-2xl text-white">Pre-order</h2>
                    </div>

                    <div className="mt-4 rounded-2xl border border-border bg-bg-surface/60 p-5">
                      {preorderInitialItems.length > 0 ? (
                        <>
                          <ul className="space-y-2">
                            {preorderInitialItems.map((it) => (
                              <li
                                key={it.menu_item_id}
                                className="flex justify-between text-sm text-text-secondary"
                              >
                                <span>
                                  {it.quantity} × {it.name}
                                </span>
                                <span className="font-mono">
                                  ${(it.unit_price * it.quantity).toFixed(2)}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <dl className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
                            <div className="flex justify-between">
                              <dt className="text-text-muted">Subtotal</dt>
                              <dd className="font-mono text-text-secondary">
                                ${preorderSubtotalDollars.toFixed(2)}
                              </dd>
                            </div>
                            {preorderTaxRate != null && preorderTaxRate > 0 && (
                              <div className="flex justify-between">
                                <dt className="text-text-muted">
                                  Tax ({(preorderTaxRate * 100).toFixed(2)}%)
                                </dt>
                                <dd className="font-mono text-text-secondary">
                                  ${preorderTaxDollars.toFixed(2)}
                                </dd>
                              </div>
                            )}
                            <div className="flex justify-between border-t border-border pt-1 text-base">
                              <dt className="text-white">Total</dt>
                              <dd className="font-mono font-semibold text-white">
                                ${preorderTotalDollars.toFixed(2)}
                              </dd>
                            </div>
                          </dl>
                        </>
                      ) : (
                        <p className="text-sm text-text-secondary">
                          You haven't added a pre-order to this booking. Add
                          dishes now so the kitchen has time to prep before
                          you arrive.
                        </p>
                      )}

                      <div className="mt-4">
                        <TooltipProvider delayDuration={150}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-block w-full sm:w-auto">
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={!canEditPreorder}
                                  onClick={openPreorderDialog}
                                  className="h-10 w-full rounded-md font-medium sm:w-auto"
                                >
                                  <PencilLine className="size-4" />
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
                  </div>
                )}

                {paymentData &&
                  (paymentData.orders.length > 0 || paymentData.deposits.length > 0) && (
                    <div className="mt-10">
                      <div className="flex items-center gap-2">
                        <CreditCard className="size-4 text-gold" />
                        <h2 className="font-serif text-2xl text-white">Payment summary</h2>
                      </div>

                      {paymentData.orders.map((order) => (
                        <div
                          key={order.id}
                          className="mt-4 rounded-2xl border border-border bg-bg-surface/60 p-5"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-white">
                              {order.is_preorder ? "Pre-ordered items" : "Order"}
                            </p>
                            <PaymentStatusBadge status={order.status} />
                          </div>
                          {order.order_items.length > 0 && (
                            <ul className="mt-3 space-y-2">
                              {order.order_items.map((it) => (
                                <li
                                  key={it.id}
                                  className="flex justify-between text-sm text-text-secondary"
                                >
                                  <span>
                                    {it.quantity} × {it.name}
                                  </span>
                                  <span>
                                    ${(Number(it.unit_price) * Number(it.quantity)).toFixed(2)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <div className="mt-4 flex justify-between border-t border-border pt-3 text-sm">
                            <span className="text-text-muted">Total</span>
                            <span
                              className={cn(
                                "font-semibold",
                                order.status === "refunded"
                                  ? "text-text-muted line-through"
                                  : "text-white",
                              )}
                            >
                              ${Number(order.total_amount ?? 0).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}

                      {paymentData.deposits.map((dep) => (
                        <div
                          key={dep.id}
                          className="mt-4 rounded-2xl border border-border bg-bg-surface/60 p-5"
                        >
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-white">Deposit</p>
                            <PaymentStatusBadge
                              status={dep.status === "charged" ? "paid" : dep.status}
                            />
                          </div>
                          {dep.payer_full_name && (
                            <p className="mt-1 text-xs text-text-muted">{dep.payer_full_name}</p>
                          )}
                          <div className="mt-4 flex justify-between border-t border-border pt-3 text-sm">
                            <span className="text-text-muted">Amount</span>
                            <span
                              className={cn(
                                "font-semibold",
                                dep.status === "refunded"
                                  ? "text-text-muted line-through"
                                  : "text-white",
                              )}
                            >
                              ${(dep.amount_cents / 100).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      ))}

                      {paymentData.totalRefundedCents > 0 && (
                        <p className="mt-3 text-xs text-text-muted">
                          ${(paymentData.totalRefundedCents / 100).toFixed(2)} refunded to your
                          original payment method. Refunds typically appear within 5–10 business
                          days.
                        </p>
                      )}
                    </div>
                  )}
              </section>

              <aside className="space-y-3 rounded-2xl border border-border bg-bg-base/40 p-4">
                <Button asChild className="h-11 w-full rounded-md font-semibold">
                  <Link to={`/${reservation.restaurant?.slug ?? ""}`}>View restaurant</Link>
                </Button>
                {canModify && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openModifyDialog}
                    className="h-11 w-full rounded-md font-medium"
                  >
                    <PencilLine className="size-4" />
                    Modify booking
                  </Button>
                )}
                {canEditPreorder ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={openPreorderDialog}
                    className="h-11 w-full rounded-md font-medium"
                  >
                    <UtensilsCrossed className="size-4" />
                    {preorderInitialItems.length > 0 ? "Edit pre-order" : "Add pre-order"}
                  </Button>
                ) : (
                  // Only render the disabled state when the booking is still
                  // active (status pending/confirmed). Past/cancelled bookings
                  // shouldn't show this affordance at all.
                  cartEditAllowedByStatus ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled
                      className="h-11 w-full rounded-md font-medium"
                      title="Pre-order locks 2 hours before your reservation"
                    >
                      <UtensilsCrossed className="size-4" />
                      Pre-order locked
                    </Button>
                  ) : null
                )}
                {reservation.restaurant?.address ? (
                  <Button asChild variant="outline" className="h-11 w-full rounded-md font-medium">
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        `${reservation.restaurant.address} ${restaurantName}`,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MapPin className="size-4" />
                      Directions
                    </a>
                  </Button>
                ) : (
                  <Button disabled variant="outline" className="h-11 w-full rounded-md font-medium">
                    <MapPin className="size-4" />
                    Directions
                  </Button>
                )}
                {reservation.restaurant?.phone ? (
                  <Button asChild variant="outline" className="h-11 w-full rounded-md font-medium">
                    <a href={`tel:${reservation.restaurant.phone}`}>
                      <Phone className="size-4" />
                      Call
                    </a>
                  </Button>
                ) : (
                  <Button disabled variant="outline" className="h-11 w-full rounded-md font-medium">
                    <Phone className="size-4" />
                    Call
                  </Button>
                )}
                {canCancel ? (
                  <button
                    type="button"
                    onClick={() => setCancelConfirmOpen(true)}
                    disabled={cancelling}
                    className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-danger/50 bg-danger/10 text-sm font-medium text-danger transition-colors hover:bg-danger/20 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <X className="size-4" />
                    {cancelling ? "Cancelling..." : "Cancel booking"}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-bg-surface p-3 text-sm text-text-secondary">
                    <CheckCircle2 className="size-4 text-gold" />
                    This booking cannot be cancelled.
                  </div>
                )}
              </aside>
            </div>
          </div>
        )}
      </main>

      <Dialog open={modifyOpen} onOpenChange={setModifyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Modify booking</DialogTitle>
          </DialogHeader>
          {reservation && modifyInitial ? (
            <ModifyBookingFields
              key={`${reservation.id}-${modifyOpen}`}
              restaurantId={reservation.restaurant?.id ?? ""}
              restaurantTimezone={reservation.restaurant?.timezone ?? null}
              reservationId={reservation.id}
              userProfileId={profile?.id ?? null}
              initial={modifyInitial}
              onChange={setModifyValues}
              onValidityChange={setModifyValidity}
            />
          ) : null}
          {/*
            Card-style CTA mirroring the customer "Reserve a table" pattern.
            The button label encodes the current state — saving, loading,
            blocking reason, no-pick, no-changes, or the dynamic "Confirm
            7:15pm changes" when the new combo is bookable.
          */}
          {(() => {
            const pickedTime = modifyValues?.time
              ? formatCompactTimeLabel(modifyValues.time)
              : null;
            const ctaLabel = modifying
              ? "Saving…"
              : modifyValidity.reasonKind === "blocking" && modifyValidity.reason
                ? modifyValidity.reason
                : modifyValidity.reasonKind === "neutral" && modifyValidity.reason
                  ? modifyValidity.reason
                  : modifyValidity.canSave && pickedTime
                    ? `Confirm ${pickedTime} changes`
                    : "Pick new details to continue";
            return (
              <div className="mt-2 space-y-2">
                <Button
                  type="button"
                  onClick={() => void handleModify()}
                  disabled={modifying || !modifyValidity.canSave}
                  className="h-14 w-full rounded-xl text-base font-semibold"
                >
                  {ctaLabel}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setModifyOpen(false)}
                  disabled={modifying}
                  className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
                >
                  Keep current booking
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* 2026-05-27: deposit-delta payment dialog. Mounted when modify-
          reservation returned requires_payment. After Stripe succeeds we
          call confirm-modify-payment to actually apply the slot change. */}
      <Dialog
        open={pendingPayment !== null}
        onOpenChange={(open) => {
          if (!open && !finalizingPayment) setPendingPayment(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {SPLIT_TENDER_ENABLED && pendingPayment?.isSplitTender
                ? "Pay deposit across all cards"
                : "Pay deposit to confirm changes"}
            </DialogTitle>
          </DialogHeader>
          {pendingPayment ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-bg-surface/60 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary">Additional deposit</span>
                  <span className="font-mono text-base font-semibold text-white">
                    ${(pendingPayment.deltaCents / 100).toFixed(2)}
                  </span>
                </div>
                <p className="mt-2 text-xs text-text-muted">
                  {SPLIT_TENDER_ENABLED && pendingPayment.isSplitTender
                    ? `Split-tender — the delta is divided across ${pendingPayment.depositPaymentRowIds.length} cards proportional to each payer's original share. All cards must succeed to confirm the change.`
                    : "Your party size update requires a larger deposit. Pay now to confirm. We'll only charge if Stripe accepts the card."}
                </p>
                {SPLIT_TENDER_ENABLED && pendingPayment.isSplitTender ? (
                  <ul className="mt-3 space-y-1 text-xs text-text-muted">
                    {pendingPayment.splitPayers.map((p, i) => (
                      <li key={p.row_id} className="flex items-center justify-between gap-2">
                        <span className="truncate">
                          #{i + 1} ·{" "}
                          {(p.payer_full_name ?? "").trim() ||
                            (p.payer_email ?? "").trim() ||
                            `Co-payer ${i + 1}`}
                        </span>
                        <span className="font-mono tabular-nums">
                          ${(p.amount_cents / 100).toFixed(2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {SPLIT_TENDER_ENABLED && pendingPayment.isSplitTender ? (
                <>
                  <SplitTenderPaymentForm
                    restaurantId={pendingPayment.restaurantId}
                    foodTotalCents={pendingPayment.deltaCents}
                    taxTotalCents={0}
                    payerCount={pendingPayment.depositPaymentRowIds.length}
                    holdId={null}
                    formId="modify-split-pay-form"
                    onPreCheckout={async () => ({
                      reservation_id: pendingPayment.reservationId,
                      deposit_row_ids: pendingPayment.depositPaymentRowIds,
                    })}
                    onAllPaid={async ({ paymentIntentIds }) => {
                      await handleModifyPaymentPaid(paymentIntentIds);
                    }}
                    onError={(msg) =>
                      errorToast(new Error(msg), {
                        fallback: "Card couldn't be charged.",
                        logTag: "[BookingDetailsPage.splitModify]",
                      })
                    }
                  />
                  <Button
                    type="submit"
                    form="modify-split-pay-form"
                    disabled={finalizingPayment}
                    className="h-10 w-full"
                  >
                    {finalizingPayment ? "Finalizing…" : "Pay & confirm changes"}
                  </Button>
                </>
              ) : (
                <StripePaymentForm
                  restaurantId={pendingPayment.restaurantId}
                  amountCents={pendingPayment.deltaCents}
                  depositPaymentIds={pendingPayment.depositPaymentRowIds}
                  onPaid={handleModifyPaymentPaid}
                  payButtonLabel={finalizingPayment ? "Finalizing…" : "Pay & confirm changes"}
                />
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setPendingPayment(null)}
                disabled={finalizingPayment}
                className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
              >
                Cancel — keep current booking
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 2026-05-27: Edit pre-order modal. Mutually exclusive with the
          modify dialog above. On success refreshes both reservation +
          payments so the new cart appears immediately. */}
      {reservation?.restaurant?.id && (
        <EditPreorderModal
          open={preorderOpen}
          onOpenChange={setPreorderOpen}
          reservationId={reservation.id}
          restaurantId={reservation.restaurant.id}
          restaurantProvince={paymentData?.restaurant?.province ?? null}
          restaurantTaxRate={paymentData?.restaurant?.tax_rate ?? null}
          initialItems={preorderInitialItems}
          initialPromoCode={
            paymentData?.reservation?.applied_promo_code ??
            reservation.applied_promo_code ??
            null
          }
          auth={{ kind: "logged_in" }}
          onSaved={(summary) => {
            void refresh();
            void refreshPayments();
            if (reservation.restaurant?.id) {
              invalidateAvailabilityCache(reservation.restaurant.id);
            }
            if (summary.requiredPayment) {
              toast.success("Pre-order updated and charged.");
            } else if (summary.refundedCents && summary.refundedCents > 0) {
              toast.success(
                `Pre-order updated. $${(summary.refundedCents / 100).toFixed(2)} refunded to your card.`,
              );
            } else {
              toast.success("Pre-order updated.");
            }
          }}
        />
      )}

      <Dialog open={cancelConfirmOpen} onOpenChange={(open) => !cancelling && setCancelConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel this reservation?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            Cancelling this reservation will release your table. Any deposit or pre-order
            you've paid will be refunded to your card. This can't be undone.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelConfirmOpen(false)}
              disabled={cancelling}
            >
              Keep booking
            </Button>
            <Button
              type="button"
              onClick={() => void handleCancel()}
              disabled={cancelling}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {cancelling ? "Cancelling..." : "Cancel booking"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

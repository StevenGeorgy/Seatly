// 2026-05-28 — Shared "Payment & contact details" block surfaced on
// BOTH the logged-in booking detail page (`/bookings/:id`) and the
// guest manage view (`/r/:slug/manage`). Keeping the markup in one
// place so both surfaces evolve together as we add more fields
// (loyalty, taxes, etc.) without drifting.
//
// The two callers pass a normalized props bag — they each adapt their
// own data source (lookup_reservation_details RPC vs
// useReservationPayments hook) into this shape. We do NOT depend on
// the raw RPC shape here so the component stays caller-agnostic.

import { CreditCard, Mail, Phone, Receipt, Ticket, Timer, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getProvincialTax } from "@/lib/billing/canadianTax";
import { formatCardLabel, type PaymentMethodDisplay } from "@/lib/booking/paymentMethods";

export type BookingPaymentCardSplitTender = {
  id: string;
  payerName: string | null;
  status: string;
  amountCents: number;
  cardBrand: string | null;
  cardLast4: string | null;
};

export type BookingPaymentCardPaymentMethod = PaymentMethodDisplay;

export type BookingPaymentCardProps = {
  // Identity / contact ------------------------------------------------
  guestEmail: string | null;
  guestPhone: string | null;
  // Hint text under the email/phone row. Differs per surface
  // ("Update in /account" vs "Contact the restaurant").
  contactUpdateHint: string;
  // Payment methods used on the booking (deduped + formatted by
  // caller; can be empty).
  paymentMethods: BookingPaymentCardPaymentMethod[];
  // Deposit breakdown -------------------------------------------------
  // Provided as cents; null when no deposit tier matched.
  depositTier: {
    amountPerPersonCents: number;
    partySize: number;
    totalCents: number;
  } | null;
  // Split-tender entries when more than 1 deposit payer. Empty for
  // single-payer or no-deposit bookings.
  splitTender: BookingPaymentCardSplitTender[];
  // Promo / cancellation ----------------------------------------------
  appliedPromoCode: string | null;
  // ISO timestamp of `reservations.reserved_at`. Cancel-by deadline is
  // computed as `reservedAt − cancellationHours`. NULL hides the row.
  reservedAtIso: string | null;
  // Default 24h when null.
  cancellationHours: number | null;
  // Optional tax surfacing (logged-in surface shows it; guest doesn't
  // strictly need to but it's harmless). Falls back to provincial
  // default when `taxRate` is null.
  taxRate: number | null;
  province: string | null;
  // Restaurant timezone for the deadline formatter.
  timezone: string | null;
};

function depositStatusVariant(status: string): { label: string; className: string } {
  const normalized = status.toLowerCase();
  switch (normalized) {
    case "charged":
    case "paid":
      return { label: "Paid", className: "border-success/30 bg-success/10 text-success" };
    case "refunded":
      return {
        label: "Refunded",
        className: "border-border bg-bg-elevated text-text-secondary",
      };
    case "failed":
      return { label: "Failed", className: "border-danger/30 bg-danger/10 text-danger" };
    case "pending":
      return { label: "Pending", className: "border-gold/30 bg-gold/10 text-gold" };
    default:
      return {
        label: normalized.charAt(0).toUpperCase() + normalized.slice(1) || "—",
        className: "border-border bg-bg-elevated text-text-secondary",
      };
  }
}

function formatCancellationDeadline(
  reservedAtIso: string,
  hoursBack: number,
  timezone: string | null,
): string {
  const reservedAt = new Date(reservedAtIso);
  const deadline = new Date(reservedAt.getTime() - hoursBack * 60 * 60 * 1000);
  const tz = timezone ?? "America/Toronto";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(deadline);
}

function Row({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof CreditCard;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-border bg-bg-surface/60 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gold/10 text-gold">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
          {label}
        </p>
        <div className="mt-1 text-sm text-white">{children}</div>
      </div>
    </div>
  );
}

export function BookingPaymentContactCard(props: BookingPaymentCardProps) {
  const {
    guestEmail,
    guestPhone,
    contactUpdateHint,
    paymentMethods,
    depositTier,
    splitTender,
    appliedPromoCode,
    reservedAtIso,
    cancellationHours,
    taxRate,
    province,
    timezone,
  } = props;

  const effectiveHours = cancellationHours ?? 24;
  const deadlineLabel = reservedAtIso
    ? formatCancellationDeadline(reservedAtIso, effectiveHours, timezone)
    : null;

  const resolvedTaxRate = taxRate ?? getProvincialTax(province).rate;
  const taxLabel = `${(resolvedTaxRate * 100).toFixed(taxRate ? 2 : 0).replace(/\.00$/, "")}%`;

  const dollar = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <section className="mt-10">
      <div className="flex items-center gap-2">
        <CreditCard className="size-4 text-gold" />
        <h2 className="font-serif text-2xl text-white">Payment & contact details</h2>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* Payment methods ---------------------------------------- */}
        <Row icon={CreditCard} label="Payment method">
          {paymentMethods.length === 0 ? (
            <p className="text-text-secondary">No card on file for this booking.</p>
          ) : (
            <ul className="space-y-1">
              {paymentMethods.map((pm) => (
                <li key={pm.key} className="flex flex-wrap items-center gap-x-2">
                  <span className="font-medium">{pm.label}</span>
                  {pm.context && (
                    <span className="text-xs text-text-muted">· {pm.context}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Row>

        {/* Email + phone (logged-in vs guest hint copy differs) --- */}
        <Row icon={Mail} label="Email on file">
          <p className="break-words font-medium text-white">{guestEmail ?? "Not provided"}</p>
          <p className="mt-1 text-xs text-text-muted">{contactUpdateHint}</p>
        </Row>
        <Row icon={Phone} label="Phone on file">
          <p className="font-medium text-white">{guestPhone ?? "Not provided"}</p>
        </Row>

        {/* Deposit breakdown -------------------------------------- */}
        <Row icon={Receipt} label="Deposit">
          {depositTier ? (
            <p>
              <span className="font-medium text-white">
                {dollar(depositTier.amountPerPersonCents)}
              </span>
              <span className="text-text-secondary"> / person × {depositTier.partySize}</span>
              <span className="text-text-secondary"> = </span>
              <span className="font-medium text-white">{dollar(depositTier.totalCents)}</span>
            </p>
          ) : (
            <p className="text-text-secondary">No deposit required.</p>
          )}
        </Row>

        {/* Cancellation deadline ---------------------------------- */}
        {deadlineLabel && (
          <Row icon={Timer} label="Cancel by">
            <p>
              <span className="font-medium text-white">{deadlineLabel}</span>
              <span className="block text-xs text-text-muted">
                Cancel by this time for a full refund.
              </span>
            </p>
          </Row>
        )}

        {/* Promo code --------------------------------------------- */}
        {appliedPromoCode && (
          <Row icon={Ticket} label="Promo applied">
            <p className="font-mono text-sm font-medium uppercase tracking-wider text-white">
              {appliedPromoCode}
            </p>
          </Row>
        )}

        {/* Tax rate (informational) ------------------------------- */}
        <Row icon={Receipt} label="Tax rate">
          <p className="font-medium text-white">{taxLabel}</p>
          <p className="text-xs text-text-muted">Applied to pre-order items, where relevant.</p>
        </Row>
      </div>

      {/* Split-tender — only when more than one payer ------------- */}
      {splitTender.length > 1 && (
        <div className="mt-6 rounded-2xl border border-border bg-bg-surface/60 p-4">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-gold" />
            <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              Split tender · {splitTender.length} payers
            </h3>
          </div>
          <ul className="mt-3 divide-y divide-border">
            {splitTender.map((p) => {
              const variant = depositStatusVariant(p.status);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {p.payerName ?? "Guest"}
                    </p>
                    <p className="text-xs text-text-muted">
                      {formatCardLabel(p.cardBrand, p.cardLast4)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white">
                      {dollar(p.amountCents)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("border px-2 py-0 text-[10px]", variant.className)}
                    >
                      {variant.label}
                    </Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

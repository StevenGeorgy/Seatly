import { z } from "zod";
import {
  BoundedText,
  ConfirmationCode,
  E164Phone,
  EmailLower,
  Iso8601,
  Money,
  NonEmptyText,
  PositiveInt,
  PromoCode,
  Uuid,
} from "./base.ts";

const MAX_ADVANCE_MS = 3650 * 24 * 60 * 60 * 1000;

const FutureDateTime = Iso8601.refine(
  (iso) => {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return false;
    const now = Date.now();
    return t >= now - 60_000 && t <= now + MAX_ADVANCE_MS;
  },
  { message: "date_time must be within the booking window" },
);

export const CartItemSchema = z.object({
  menu_item_id: Uuid.nullable().optional(),
  name: NonEmptyText(200),
  quantity: PositiveInt(50),
  unit_price: Money.max(10000),
  modifiers: z
    .array(
      z.object({
        name: NonEmptyText(120),
        delta: z.number().finite(),
      }),
    )
    .max(20)
    .optional(),
});

export const BookingInputSchema = z.object({
  restaurant_id: Uuid,
  shift_id: Uuid,
  date_time: FutureDateTime,
  party_size: PositiveInt(30),
  guest_name: NonEmptyText(120),
  guest_email: EmailLower,
  guest_phone: E164Phone,
  allergies: BoundedText(500).nullish(),
  seating_preference: BoundedText(200).nullish(),
  occasion: BoundedText(100).nullish(),
  confirmation_code: ConfirmationCode.nullish(),
  cart_items: z.array(CartItemSchema).max(50).nullish(),
  subtotal: Money.nullish(),
  tax_amount: Money.nullish(),
  tip_amount: Money.max(5000).nullish(),
  total_amount: Money.nullish(),
  discount_amount: Money.nullish(),
  discount_reason: BoundedText(200).nullish(),
  payment_method: BoundedText(40).nullish(),
  applied_promo_code: PromoCode.nullish(),
  event_id: Uuid.nullish(),
  promotion_id: Uuid.nullish(),
  hold_id: Uuid.nullish(),
  // Split-tender mode (2026-05-20). When set, the fn creates the
  // reservation in `pending_payment` status AND inserts N rows in
  // `reservation_deposit_payments` (each share of the deposit), then
  // returns the row IDs. The diner UI then charges N PIs sequentially
  // via SplitTenderPaymentForm. Range 2-10 matches the UI cap.
  split_tender_payers: z.number().int().min(2).max(10).nullish(),
  // 2026-05-23: optional per-payer share amount in cents (deposit + preorder
  // + tax). When provided, overrides the deposit-only split. Required for
  // pre-order split-tender (where deposit is 0 but each card still needs
  // to cover their share of the food). For deposit-only split (legacy
  // behavior) omit this and the backend derives shares from deposit alone.
  split_tender_share_cents: z.number().int().min(1).max(10_000_000).nullish(),
  // 2026-05-27: optional per-payer contact details. When set, each entry's
  // email + name are written onto the matching reservation_deposit_payments
  // row (by index) so the post-settle confirmation fan-out can email each
  // friend their own share. When omitted, all rows are seeded with the
  // booker's contact (today's behavior).
  split_tender_payer_details: z
    .array(
      z.object({
        email: EmailLower,
        full_name: NonEmptyText(120).optional(),
      }),
    )
    .max(10)
    .nullish(),
}).refine(
  (data) => {
    if (!data.split_tender_payer_details) return true;
    if (!data.split_tender_payers) return false;
    return data.split_tender_payer_details.length === data.split_tender_payers;
  },
  {
    message: "split_tender_payer_details length must equal split_tender_payers",
    path: ["split_tender_payer_details"],
  },
);

export type BookingInput = z.infer<typeof BookingInputSchema>;

export const ModifyReservationSchema = z
  .object({
    reservation_id: Uuid.optional(),
    reservationId: Uuid.optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
    time: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d(\s?[apAP][mM])?$/, "invalid time"),
    party_size: PositiveInt(30).optional(),
    partySize: PositiveInt(30).optional(),
    special_request: BoundedText(500).optional(),
    specialRequest: BoundedText(500).optional(),
    confirmation_code: ConfirmationCode.optional(),
    confirmationCode: ConfirmationCode.optional(),
    // Guest path second factor (since 2026-05-22). See CancelReservationSchema
    // for the rationale — closes the code-only enumeration attack. Ignored
    // for JWT-authed callers.
    email: BoundedText(254).optional(),
  })
  .refine(
    (b) => b.reservation_id !== undefined || b.reservationId !== undefined,
    {
      message: "reservation_id is required",
      path: ["reservation_id"],
    },
  )
  .refine((b) => b.party_size !== undefined || b.partySize !== undefined, {
    message: "party_size is required",
    path: ["party_size"],
  });

export type ModifyReservationInput = z.infer<typeof ModifyReservationSchema>;

export const CancelReservationSchema = z
  .object({
    reservation_id: Uuid.optional(),
    reservationId: Uuid.optional(),
    confirmation_code: ConfirmationCode.optional(),
    confirmationCode: ConfirmationCode.optional(),
    // Guest path requires the email on the reservation as a second factor —
    // prevents code-only enumeration attacks. Logged-in (JWT) callers ignore
    // this field; owner-actor calls ignore it too. Accept loose BoundedText
    // here so the handler can return a friendly "we couldn't verify" message
    // rather than a Zod parse error.
    email: BoundedText(254).optional(),
    actor: z.enum(["diner", "owner"]).optional(),
  })
  .refine(
    (b) => b.reservation_id !== undefined || b.reservationId !== undefined,
    {
      message: "reservation_id is required",
      path: ["reservation_id"],
    },
  );

export type CancelReservationInput = z.infer<typeof CancelReservationSchema>;

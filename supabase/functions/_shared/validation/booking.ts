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
  // 2026-05-28: PI bound by client AFTER it succeeds with Stripe but
  // BEFORE create-public-booking returns. Lets us stamp the PI ID onto
  // orders.stripe_payment_intent_id so cart-shrink + cancel refund paths
  // can find the right Stripe charge to reverse. The "Mode B" PI path
  // (saved card, no hold) doesn't put reservation_id on PI metadata, so
  // the stripe-webhook can't back-fill on its own — this is the fix.
  payment_intent_id: z.string().regex(/^pi_/, "must start with pi_").max(255).nullish(),
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

// Cart-modify item shape (2026-05-27). Distinct from CartItemSchema above —
// modify-reservation only needs (menu_item_id, quantity); server looks up
// the price from menu_items.price so the client cannot influence pricing.
export const ModifyCartItemSchema = z.object({
  menu_item_id: Uuid,
  quantity: z.number().int().positive().max(99),
});

export const ModifyReservationSchema = z
  .object({
    reservation_id: Uuid.optional(),
    reservationId: Uuid.optional(),
    // 2026-05-27: date/time/party_size are now optional. A cart-only modify
    // (cart_items present, no slot fields) bypasses slot validation entirely.
    // The mixed-payload guard inside modify-reservation rejects requests
    // that try to combine both kinds.
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
    time: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d(\s?[apAP][mM])?$/, "invalid time")
      .optional(),
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
    // ──────────────────────────────────────────────────────────────────
    // Cart-modify path (2026-05-27). Strictly separate from the slot
    // modify path — combining them returns 400 `mixed_modify_not_allowed`.
    // - cart_items: full replacement of the reservation's pre-order cart.
    // - applied_promo_code: tri-state — `undefined` keeps existing,
    //   `string` sets/replaces, `null`/`""` clears.
    // - tax_cents: client's calculated tax for cross-check. Server
    //   recomputes from restaurants.tax_rate and uses its own value;
    //   a mismatch >1¢ is logged but not rejected.
    // ──────────────────────────────────────────────────────────────────
    cart_items: z.array(ModifyCartItemSchema).max(50).optional(),
    applied_promo_code: z.string().trim().max(64).nullable().optional(),
    tax_cents: z.number().int().nonnegative().max(10_000_000).optional(),
  })
  .refine(
    (b) => b.reservation_id !== undefined || b.reservationId !== undefined,
    {
      message: "reservation_id is required",
      path: ["reservation_id"],
    },
  )
  .refine(
    (b) => {
      const isCartModify = b.cart_items !== undefined;
      if (isCartModify) return true; // party_size not required for cart-only
      return b.party_size !== undefined || b.partySize !== undefined;
    },
    {
      message: "party_size is required for slot modifications",
      path: ["party_size"],
    },
  )
  .refine(
    (b) => {
      const isCartModify = b.cart_items !== undefined;
      if (isCartModify) return true; // date/time not required for cart-only
      return b.date !== undefined && b.time !== undefined;
    },
    {
      message: "date and time are required for slot modifications",
      path: ["date"],
    },
  );

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

// restaurant-ops.ts: shared body schemas for restaurant lifecycle / publish
// / ops edge fns. Owned by Phase C input-validation rollout (2026-05-20).

import { z } from "zod";
import { BoundedText, EmailLower, NonEmptyText, Uuid } from "./base.ts";

// publish-restaurant: { restaurant_id, disclosure_text,
//   partner_agreement_accepted, partner_agreement_version,
//   partner_agreement_disclosure_text }
// The agreement fields are required for new publishes (the wizard requires
// the checkbox); a separate consent_type='partner_agreement' row is written
// to subscription_consent_log capturing exactly which version + disclosure
// text the owner accepted.
export const PublishRestaurantSchema = z.object({
  restaurant_id: Uuid,
  disclosure_text: NonEmptyText(2000),
  partner_agreement_accepted: z.literal(true),
  partner_agreement_version: NonEmptyText(40),
  partner_agreement_disclosure_text: NonEmptyText(2000),
});
export type PublishRestaurantInput = z.infer<typeof PublishRestaurantSchema>;

// delete-restaurant: { restaurant_id (or restaurantId), confirmationName }
// Accepts both snake_case and camelCase for restaurant_id since the existing
// client passes either.
export const DeleteRestaurantSchema = z
  .object({
    restaurant_id: Uuid.optional(),
    restaurantId: Uuid.optional(),
    confirmationName: NonEmptyText(200),
  })
  .refine((v) => Boolean(v.restaurant_id || v.restaurantId), {
    message: "restaurant_id is required",
    path: ["restaurant_id"],
  });
export type DeleteRestaurantInput = z.infer<typeof DeleteRestaurantSchema>;

// dispatch-deposit-invites: { reservation_id, app_origin?, organizer_email? }
export const DispatchDepositInvitesSchema = z.object({
  reservation_id: Uuid,
  app_origin: BoundedText(500).url().optional(),
  organizer_email: EmailLower.optional(),
});
export type DispatchDepositInvitesInput = z.infer<
  typeof DispatchDepositInvitesSchema
>;

// notify-deposit-payers-refunded: { reservation_id, refunded_payer_ids? }
export const NotifyDepositPayersRefundedSchema = z.object({
  reservation_id: Uuid,
  refunded_payer_ids: z.array(Uuid).max(50).optional(),
});
export type NotifyDepositPayersRefundedInput = z.infer<
  typeof NotifyDepositPayersRefundedSchema
>;

// detect-duplicates: { restaurant_id, phone?, email? } — must include phone OR email
export const DetectDuplicatesSchema = z
  .object({
    restaurant_id: Uuid,
    // Owner-dashboard search field — relaxed format (raw input, no E.164
    // normalization required) but length-capped to prevent abuse.
    phone: BoundedText(40).optional(),
    email: BoundedText(254).optional(),
  })
  .refine(
    (v) => Boolean((v.phone && v.phone.trim()) || (v.email && v.email.trim())),
    { message: "phone or email is required", path: ["phone"] },
  );
export type DetectDuplicatesInput = z.infer<typeof DetectDuplicatesSchema>;

// geocode-restaurants: POST body { restaurant_id? } (omitting triggers backfill mode on GET)
export const GeocodeRestaurantSchema = z.object({
  restaurant_id: Uuid.optional(),
});
export type GeocodeRestaurantInput = z.infer<typeof GeocodeRestaurantSchema>;

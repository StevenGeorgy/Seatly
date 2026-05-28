import { z } from "zod";
import {
  BoundedText,
  EmailLower,
  Money,
  NonEmptyText,
  PositiveInt,
  Uuid,
} from "./base.ts";

// Restaurant fields accepted across the onboarding surface. signup-restaurant-
// owner accepts BOTH this restaurant-shaped data + auth fields (email,
// password, full_name) for the legacy account-creation branch; those auth
// fields are validated by SignupRestaurantOwnerSchema below.
// Wizard payloads send `null` (not `undefined`) for empty optional fields —
// .nullish() lets Zod accept both null and undefined. Tightening these to
// `.optional()` would reject the wizard's natural payload shape. Handlers
// already treat null and undefined identically (null-coalesce reads).
export const RestaurantOnboardingSchema = z.object({
  restaurant_name: NonEmptyText(120),
  description: BoundedText(2000).nullish(),
  address: BoundedText(300).nullish(),
  city: BoundedText(120).nullish(),
  province: BoundedText(80).nullish(),
  postal_code: BoundedText(20).nullish(),
  hst_registration_number: BoundedText(40).nullish(),
  country: BoundedText(80).nullish(),
  // Owner-side phone: relaxed format (just length-capped). Diner-side flows
  // run normalizeE164Phone first; the onboarding wizard currently accepts
  // raw user input. Tighten to E.164 in a later phase once the wizard
  // normalizes.
  phone: BoundedText(20).nullish(),
  cuisine_type: BoundedText(80).nullish(),
  business_type: BoundedText(80).nullish(),
  price_range: z.enum(["$", "$$", "$$$", "$$$$"]).nullish(),
  dietary_tags: z.array(BoundedText(80)).max(30).nullish(),
  lat: z.number().finite().min(-90).max(90).nullish(),
  lng: z.number().finite().min(-180).max(180).nullish(),
  force_new: z.boolean().nullish(),
  restaurant_id: Uuid.nullish(),
});

// Full-payload schema for signup-restaurant-owner. Accepts the restaurant-
// shaped fields above PLUS:
// - Auth fields used only on the legacy email/password branch (when no
//   bearer token is supplied). Optional at the schema level so the JWT
//   branch passes; the handler enforces "required for legacy" itself
//   AND preserves the email-enumeration uniform-response logic
//   (Vuln 9 fix, 2026-05-20).
// - Operational toggles (timezone, currency, accepts_walkins, hours_json,
//   tables list, etc.) passed straight through. We .passthrough() these
//   rather than enumerating every shape because the handler reads them
//   directly off the body — adding strict validation across every field
//   would risk silently dropping a property the handler depends on.
// What this schema GUARANTEES is shape + caps on the dangerous fields:
// restaurant_name, description, address, city, phone, email, full_name,
// password length.
export const SignupRestaurantOwnerSchema = RestaurantOnboardingSchema.extend({
  // Accept both snake_case (canonical) + camelCase (legacy clients).
  // .nullish() throughout because wizard sends null for empty fields.
  restaurantName: NonEmptyText(120).nullish(),
  full_name: BoundedText(200).nullish(),
  fullName: BoundedText(200).nullish(),
  email: EmailLower.nullish(),
  password: BoundedText(200).nullish(),
  hours_json: z.record(z.string(), z.unknown()).nullish(),
  tables: z
    .array(
      z.object({
        label: BoundedText(40).optional(),
        capacity: z.number().int().positive().max(60).optional(),
        shape: BoundedText(20).optional(),
      }).passthrough(),
    )
    .max(200)
    .nullish(),
  timezone: BoundedText(80).nullish(),
  currency: BoundedText(8).nullish(),
  accepts_walkins: z.boolean().nullish(),
  no_show_fee: z.number().finite().nonnegative().max(10_000).nullish(),
  requires_deposit: z.boolean().nullish(),
  deposit_amount: z.number().finite().nonnegative().max(10_000).nullish(),
  loyalty_enabled: z.boolean().nullish(),
  loyalty_points_per_dollar: z.number().finite().nonnegative().max(1000).nullish(),
}).passthrough();

export type SignupRestaurantOwnerInput = z.infer<
  typeof SignupRestaurantOwnerSchema
>;

export type RestaurantOnboardingInput = z.infer<
  typeof RestaurantOnboardingSchema
>;

export const MenuItemSchema = z.object({
  name: NonEmptyText(200),
  description: BoundedText(1000).optional(),
  price: Money.max(10000),
  category: BoundedText(80).optional(),
  allergens: z.array(BoundedText(40)).max(20).optional(),
  photo_url: BoundedText(2000).url().optional(),
  is_active: z.boolean().optional(),
});

export type MenuItemInput = z.infer<typeof MenuItemSchema>;

const HoursWindow = z.object({
  open: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/),
});

const DayKey = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export const HoursJsonSchema = z.partialRecord(
  DayKey,
  z.array(HoursWindow).max(4),
);

export type HoursJson = z.infer<typeof HoursJsonSchema>;

export const DepositTierSchema = z.object({
  min_party_size: PositiveInt(50),
  amount_cents: z.number().int().nonnegative().max(100_000_00),
});

export const DepositTiersSchema = z.array(DepositTierSchema).max(20);

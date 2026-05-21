import { z } from "zod";
import {
  BoundedText,
  EmailLower,
  Money,
  NonEmptyText,
  PositiveInt,
} from "./base.ts";

// Restaurant fields accepted across the onboarding surface. signup-restaurant-
// owner accepts BOTH this restaurant-shaped data + auth fields (email,
// password, full_name) for the legacy account-creation branch; those auth
// fields are validated by SignupRestaurantOwnerSchema below.
export const RestaurantOnboardingSchema = z.object({
  restaurant_name: NonEmptyText(120),
  description: BoundedText(2000).optional(),
  address: BoundedText(300).optional(),
  city: BoundedText(120).optional(),
  province: BoundedText(80).optional(),
  postal_code: BoundedText(20).optional(),
  country: BoundedText(80).optional(),
  // Owner-side phone: relaxed format (just length-capped). Diner-side flows
  // run normalizeE164Phone first; the onboarding wizard currently accepts
  // raw user input. Tighten to E.164 in a later phase once the wizard
  // normalizes.
  phone: BoundedText(20).optional(),
  cuisine_type: BoundedText(80).optional(),
  business_type: BoundedText(80).optional(),
  price_range: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
  dietary_tags: z.array(BoundedText(80)).max(30).optional(),
  lat: z.number().finite().min(-90).max(90).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
  force_new: z.boolean().optional(),
  restaurant_id: z.string().uuid().optional(),
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
  restaurantName: NonEmptyText(120).optional(),
  full_name: BoundedText(200).optional(),
  fullName: BoundedText(200).optional(),
  email: EmailLower.optional(),
  // Password: capped at 200 chars (Supabase Auth max). Min-length is
  // enforced by Supabase itself — we just prevent absurd payloads.
  password: BoundedText(200).optional(),
  hours_json: z.record(z.string(), z.unknown()).optional(),
  tables: z
    .array(
      z.object({
        label: BoundedText(40).optional(),
        capacity: z.number().int().positive().max(60).optional(),
        shape: BoundedText(20).optional(),
      }).passthrough(),
    )
    .max(200)
    .optional(),
  timezone: BoundedText(80).optional(),
  currency: BoundedText(8).optional(),
  accepts_walkins: z.boolean().optional(),
  no_show_fee: z.number().finite().nonnegative().max(10_000).optional(),
  cancellation_hours: z.number().int().nonnegative().max(720).optional(),
  requires_deposit: z.boolean().optional(),
  deposit_amount: z.number().finite().nonnegative().max(10_000).optional(),
  loyalty_enabled: z.boolean().optional(),
  loyalty_points_per_dollar: z.number().finite().nonnegative().max(1000).optional(),
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

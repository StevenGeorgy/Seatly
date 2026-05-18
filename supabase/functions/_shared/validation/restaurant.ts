import { z } from "zod";
import {
  BoundedText,
  Money,
  NonEmptyText,
  PositiveInt,
} from "./base.ts";

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

import { z } from "zod";
import { BoundedText, E164Phone, EmailLower, NonEmptyText } from "./base.ts";

export const DietaryRestrictionsSchema = z
  .array(BoundedText(80))
  .max(50);

export const AllergiesSchema = z.array(BoundedText(80)).max(50);

export const ProfileUpdateSchema = z.object({
  full_name: NonEmptyText(120).optional(),
  email: EmailLower.optional(),
  phone: E164Phone.optional(),
  dietary_restrictions: DietaryRestrictionsSchema.optional(),
  allergies: AllergiesSchema.optional(),
  cenaiva_tts_voice: BoundedText(80).optional(),
});

export type ProfileUpdateInput = z.infer<typeof ProfileUpdateSchema>;

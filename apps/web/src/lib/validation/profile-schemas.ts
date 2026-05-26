import { z } from "zod";

// Email is intentionally optional here even though it's still tracked on
// the profile row. Email *changes* happen exclusively through
// /account/security (Supabase auth verification flow); the profile-edit
// form no longer surfaces email, so callers don't pass it.
export const profileUpdateSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Invalid email address").optional(),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  dietary_restrictions: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
  avatar_url: z.string().url().nullable().optional(),
});

export type ProfileUpdateValues = z.infer<typeof profileUpdateSchema>;

/**
 * Completeness check used by RequireCompleteProfile gate and OnboardingPage.
 * A profile is "complete enough to book" only when ALL THREE of
 * `full_name`, `email`, and `phone` are non-empty. Email is required for
 * receipts; phone is required for SMS confirmations. Both must be on
 * file before any reservation can be committed.
 */
export const profileCompletenessSchema = z.object({
  full_name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().email("Email is required"),
  phone: z.string().trim().min(1, "Phone is required"),
});

export type ProfileCompletenessValues = z.infer<typeof profileCompletenessSchema>;

/**
 * Pure helper that mirrors what RequireCompleteProfile checks at the
 * routing layer. Returns true when full_name, email, AND phone are all
 * present + non-empty on the profile row.
 */
export function isProfileComplete(profile: {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
}): boolean {
  return Boolean(
    profile.full_name?.trim() &&
      profile.email?.trim() &&
      profile.phone?.trim(),
  );
}

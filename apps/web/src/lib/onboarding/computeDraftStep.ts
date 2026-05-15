import type { HoursJson } from "@/components/onboarding/wizardTypes";

export type DraftStepInputs = {
  hours_json: HoursJson | null;
  cover_photo_url: string | null;
  deposit_tiers: unknown[] | null;
  hasTables: boolean;
  hasShift: boolean;
  tierItemCount: number;
};

/**
 * Returns the 1-based step index (1..8) the wizard should resume at given a
 * restaurant's persisted state. Mirrors the gating logic the SetupPage
 * resume-effect used inline. Shared by:
 *   - SetupPage's loadInProgressRestaurant
 *   - DraftsPage (badge subtitle)
 *   - Workspace switcher (badge subtitle)
 *
 * Step 1 is never returned — by the time a row exists in `restaurants`,
 * Step 1 has been submitted. The minimum value is 2 (Hours).
 */
export function computeDraftStep(inputs: DraftStepInputs): number {
  const hasHours =
    inputs.hours_json !== null &&
    Object.values(inputs.hours_json).some((v) => v !== null);
  const hasMenuItems = inputs.tierItemCount >= 3;
  const hasCover = Boolean(inputs.cover_photo_url);
  // NULL = Step 7 not done. Empty array = "explicit no deposits", done.
  const hasDepositPolicy = inputs.deposit_tiers !== null;

  if (!hasHours) return 2;
  if (!inputs.hasTables) return 3;
  if (!inputs.hasShift) return 4;
  if (!hasMenuItems) return 5;
  if (!hasCover) return 6;
  if (!hasDepositPolicy) return 7;
  return 8;
}

export const WIZARD_TOTAL_STEPS = 8 as const;

// referral.ts: shared schemas for the referral program (Phase C input
// validation, 2026-05-20). Used by apply-referral-credit; future
// validate-referral-code can also live here.

import { z } from "zod";
import { Uuid } from "./base.ts";

// apply-referral-credit: { restaurant_id }
export const ApplyReferralCreditSchema = z.object({
  restaurant_id: Uuid,
});
export type ApplyReferralCreditInput = z.infer<
  typeof ApplyReferralCreditSchema
>;

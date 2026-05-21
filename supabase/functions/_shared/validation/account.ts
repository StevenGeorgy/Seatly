// account.ts: shared schemas for diner-account edge fns (delete-account,
// merge-diner-accounts). Phase C input-validation rollout (2026-05-20).

import { z } from "zod";
import { BoundedText, Uuid } from "./base.ts";

// delete-account: { email_confirmation }. The function compares this
// case-insensitively against user.email; we only enforce shape here.
export const DeleteAccountSchema = z.object({
  email_confirmation: BoundedText(254).min(1),
});
export type DeleteAccountInput = z.infer<typeof DeleteAccountSchema>;

// merge-diner-accounts: { canonical_auth_user_id, archived_auth_user_id }
// Both must be UUIDs; the function additionally verifies the caller is
// signed in as one of them (security-critical — DO NOT relax here).
export const MergeDinerAccountsSchema = z
  .object({
    canonical_auth_user_id: Uuid,
    archived_auth_user_id: Uuid,
  })
  .refine(
    (v) => v.canonical_auth_user_id !== v.archived_auth_user_id,
    {
      message: "Canonical and archived accounts must differ",
      path: ["archived_auth_user_id"],
    },
  );
export type MergeDinerAccountsInput = z.infer<typeof MergeDinerAccountsSchema>;

// Build-time feature flags read from Vite env (import.meta.env.VITE_*).
// Convention: flags that should default OFF use `=== "true"` so an unset
// or "false" value resolves to disabled.

// Split-tender (multi-card-at-booking) was shipped in PR-K but feature-
// flagged OFF on 2026-05-28 — the team may revive it later. While off,
// the diner never sees the "Split tender" choice and the server rejects
// any split request (SPLIT_TENDER_ENABLED on the edge functions). To
// revive: set VITE_SPLIT_TENDER_ENABLED=true (Amplify) +
// SPLIT_TENDER_ENABLED=true (Supabase secrets), redeploy
// create-public-booking + modify-reservation, rebuild web.
export const SPLIT_TENDER_ENABLED =
  import.meta.env.VITE_SPLIT_TENDER_ENABLED === "true";

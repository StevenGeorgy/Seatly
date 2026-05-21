// @ts-nocheck
// Shared internal auth check for edge functions. Verifies the JWT's
// signature via supabase-js `auth.getUser(token)`, which handles ES256
// tokens. We keep verify_jwt=false on these fns because the Supabase
// gateway doesn't yet support ES256 — but this check IS cryptographic.
//
// Previously decoded the JWT payload with atob() and trusted the `sub`
// without signature verification. That allowed anyone to forge a Bearer
// token with any user_id in the body. Fixed 2026-05-20 (security audit).

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export type AuthCheckResult =
  | { ok: true; authUserId: string; email: string | null }
  | { ok: false; reason: "missing_token" | "invalid_token" };

// Optional client param: lets callers reuse their own admin client to
// avoid spinning up a second one. The signature verification is what
// matters; either client can call auth.getUser.
export async function checkAuth(
  req: Request,
  client?: SupabaseClient,
): Promise<AuthCheckResult> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing_token" };

  const supabase = client ?? createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { ok: false, reason: "invalid_token" };
  return { ok: true, authUserId: data.user.id, email: data.user.email ?? null };
}

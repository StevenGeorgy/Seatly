// @ts-nocheck
// Shared internal auth check for edge functions where Supabase's
// `verify_jwt = true` would also work but isn't yet flipped (or where
// we want a uniform 401 error shape).

import { decodeJwtPayload } from "./jwt.ts";

export type AuthCheckResult =
  | { ok: true; authUserId: string }
  | { ok: false; reason: "missing_token" | "invalid_token" };

export function checkAuth(req: Request): AuthCheckResult {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, reason: "missing_token" };
  const payload = decodeJwtPayload(token);
  const authUserId = typeof payload?.sub === "string" ? payload.sub : null;
  if (!authUserId) return { ok: false, reason: "invalid_token" };
  return { ok: true, authUserId };
}

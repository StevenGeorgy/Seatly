// Phase 10d (CONCURRENCY_PLAN.md): edge-function-side rate limit helpers.
//
// Wraps the `check_rate_limit` Postgres RPC with sensible IP/user identifier
// extraction. Callers should:
//   1. Build an identifier with `rateLimitIdentifier(req, userId?)`.
//   2. Call `enforceRateLimit(adminClient, scope, identifier, { limit, windowSeconds })`.
//   3. If it throws a `RateLimitError`, return the message + 429.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function rateLimitIdentifier(req: Request, userId?: string | null): string {
  if (userId) return `user:${userId}`;
  // Cloudflare-style + standard X-Forwarded-For. Take the first hop, that's
  // the original client. Fall back to "anon" so a missing header still buckets.
  const xff = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  return "ip:unknown";
}

export async function enforceRateLimit(
  client: SupabaseClient,
  scope: string,
  identifier: string,
  opts: { limit: number; windowSeconds: number },
): Promise<void> {
  const key = `${scope}|${identifier}`;
  const { data, error } = await client.rpc("check_rate_limit", {
    p_key: key,
    p_limit: opts.limit,
    p_window_seconds: opts.windowSeconds,
  });
  if (error) {
    // Fail-open on rate-limit infra errors. The DB exclusion constraint and
    // advisory locks remain the real safety net.
    return;
  }
  if (data === false) {
    throw new RateLimitError(
      `Too many requests. Please wait a moment before trying again.`,
    );
  }
}

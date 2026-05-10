// @ts-nocheck
// Strict RFC 4122 v1–5 UUID regex. The orchestrator previously had two
// different copies (a strict one and a looser one); standardize on the
// strict variant.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

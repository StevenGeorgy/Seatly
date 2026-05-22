// @ts-nocheck
// Permissive UUID regex: accepts any UUID shape (v1–v8, or non-RFC4122).
// Our seed restaurant IDs in production are not strict v4 (e.g.
// `a1000006-1111-1111-1111-000000000006`), so the previous strict
// `[1-8].../[89ab]...` pattern rejected legitimate IDs. Matches the
// shape used by the Zod `Uuid` in `_shared/validation/base.ts`.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

import { createBrowserClient } from "@supabase/ssr";

const MISSING_ENV_MESSAGE =
  "Missing Supabase URL or anon key. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) in the repo root .env. Restart the dev server after changing env.";

/**
 * Supabase clients expect the **project root** (`https://ref.supabase.co`).
 * Pasting `.../rest/v1` breaks Auth (requests become `.../rest/v1/auth/v1/token` → 404).
 */
function normalizeSupabaseProjectUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  for (const suffix of [/\/rest\/v1$/i, /\/functions\/v1$/i, /\/auth\/v1$/i, /\/storage\/v1$/i]) {
    u = u.replace(suffix, "");
  }
  return u.replace(/\/+$/, "");
}

/** Project URL — same resolution as `createBrowserClient` (VITE_ then NEXT_PUBLIC_). */
export function getSupabaseProjectUrl(): string {
  const raw =
    import.meta.env.VITE_SUPABASE_URL?.trim() ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    "";
  return raw ? normalizeSupabaseProjectUrl(raw) : "";
}

/**
 * Browser anon / publishable key — same resolution as `createBrowserClient`.
 * Required on every Supabase Edge Function request as the `apikey` header.
 */
export function getSupabaseAnonKey(): string {
  return (
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    ""
  );
}

/** True when the SPA can create a browser Supabase client (no throw). */
export function isSupabaseConfigured(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const url = getSupabaseProjectUrl();
  const anonKey = getSupabaseAnonKey();
  return Boolean(url && anonKey);
}

/**
 * Browser-only Supabase client for the Vite SPA.
 */
export function getSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() must only run in the browser.");
  }

  const url = getSupabaseProjectUrl();
  const anonKey = getSupabaseAnonKey();

  if (!url || !anonKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  return createBrowserClient(url, anonKey, {
    isSingleton: true,
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

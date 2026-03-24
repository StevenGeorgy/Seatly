import { createBrowserClient } from "@supabase/ssr";

const MISSING_ENV_MESSAGE =
  "Missing Supabase URL or anon key. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY) in the repo root .env. Restart the dev server after changing env.";

function readSupabaseUrl(): string {
  return (
    import.meta.env.VITE_SUPABASE_URL?.trim() ||
    import.meta.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    ""
  );
}

function readSupabaseAnonKey(): string {
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
  const url = readSupabaseUrl();
  const anonKey = readSupabaseAnonKey();
  return Boolean(url && anonKey);
}

/**
 * Browser-only Supabase client for the Vite SPA.
 * Sessions persist across page refreshes via localStorage (default behaviour).
 */
export function getSupabaseBrowserClient() {
  if (typeof window === "undefined") {
    throw new Error("getSupabaseBrowserClient() must only run in the browser.");
  }

  const url = readSupabaseUrl();
  const anonKey = readSupabaseAnonKey();

  if (!url || !anonKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  return createBrowserClient(url, anonKey, { isSingleton: true });
}

import { createBrowserClient } from "@supabase/ssr";

// Used only during server-side prerender/build when env isn't available.
const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder-key-for-build";

function isValidUrl(s: string): boolean {
  const trimmed = (s ?? "").trim();
  return trimmed.startsWith("https://") || trimmed.startsWith("http://");
}

export function createClient() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  const envMissing = !isValidUrl(supabaseUrl) || !supabaseAnonKey;

  // Remember-me support for login UX.
  // Persisting the Supabase session is controlled by localStorage.
  // Default is OFF (so refreshes don't keep you logged in unless user opted in).
  let persistSession = false;
  try {
    if (typeof window !== "undefined") {
      persistSession = window.localStorage.getItem("seatly_remember_login") === "1";
    }
  } catch {
    // If storage is blocked, keep default persistSession=false.
    persistSession = false;
  }

  if (envMissing) {
    // In the real browser, fail fast with a clear message instead of opaque "Failed to fetch".
    if (typeof window !== "undefined") {
      throw new Error(
        "Supabase is not configured in this app runtime. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Seatly/.env, then fully restart `npm run dev`."
      );
    }
    // During SSR/prerender/build, don't crash the build.
    return createBrowserClient(PLACEHOLDER_URL, PLACEHOLDER_KEY, {
      auth: { persistSession: false },
    });
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession },
  });
}

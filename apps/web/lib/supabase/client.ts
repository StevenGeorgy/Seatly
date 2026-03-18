import { createBrowserClient } from "@supabase/ssr";

const PLACEHOLDER_URL = "https://placeholder.supabase.co";
const PLACEHOLDER_KEY = "placeholder-key-for-build";

function isValidUrl(s: string): boolean {
  const trimmed = (s ?? "").trim();
  return trimmed.startsWith("https://") || trimmed.startsWith("http://");
}

export function createClient() {
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  const url = isValidUrl(supabaseUrl) ? supabaseUrl : PLACEHOLDER_URL;
  const key = supabaseAnonKey || PLACEHOLDER_KEY;

  return createBrowserClient(url, key);
}

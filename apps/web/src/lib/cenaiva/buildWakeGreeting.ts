import type { User } from "@supabase/supabase-js";

function partOfDay(): "morning" | "afternoon" | "evening" {
  const hour = new Date().getHours();
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function firstName(user: User | null | undefined): string | null {
  const meta = user?.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const candidate =
    typeof meta?.full_name === "string"
      ? meta.full_name
      : typeof meta?.name === "string"
        ? meta.name
        : null;
  if (!candidate) return null;
  const first = candidate.trim().split(/\s+/)[0];
  return first ? first : null;
}

export function buildWakeGreeting(user: User | null | undefined): string {
  const period = partOfDay();
  const name = firstName(user);
  const namePart = name ? `, ${name}` : "";
  return `Good ${period}${namePart}. How may I help with your reservation?`;
}

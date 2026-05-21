import posthog from "posthog-js";

let isInitialized = false;

/**
 * Lazy PostHog initialization. Stays disabled (no events captured) until
 * `optInAnalytics()` is called — gated on the cookie consent flow per
 * PIPEDA / ToS §18. If `VITE_POSTHOG_KEY` is unset, every helper becomes
 * a no-op so local + preview builds run silently.
 */
export function initPostHog(): void {
  if (isInitialized) return;
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return;
  posthog.init(key, {
    api_host: (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com",
    person_profiles: "identified_only",
    opt_out_capturing_by_default: true, // gated on consent
    capture_pageview: false, // we call manually after consent
    disable_session_recording: true,
  });
  isInitialized = true;
}

export function optInAnalytics(): void {
  if (!isInitialized) initPostHog();
  if (!isInitialized) return; // still no key — silently no-op
  posthog.opt_in_capturing();
  posthog.capture("$pageview");
}

export function optOutAnalytics(): void {
  if (!isInitialized) return;
  posthog.opt_out_capturing();
}

export function isAnalyticsOptedIn(): boolean {
  if (!isInitialized) return false;
  return posthog.has_opted_in_capturing();
}

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  if (!isInitialized || !posthog.has_opted_in_capturing()) return;
  posthog.capture(name, props);
}

export function identifyUser(userId: string, traits?: Record<string, unknown>): void {
  if (!isInitialized || !posthog.has_opted_in_capturing()) return;
  posthog.identify(userId, traits);
}

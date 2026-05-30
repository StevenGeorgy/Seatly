// Schedule A — Sub-Processors. Source of truth for both the inline table
// at the bottom of /privacy and the standalone /legal/sub-processors page.
//
// Adding or materially changing a row is a contractual commitment under the
// Privacy Policy: at least 30 days' notice to users via in-app message or
// email is required before adding a sub-processor that processes personal
// information in a materially new way.

export const SUB_PROCESSORS_NOTICE_DAYS = 30;
export const SUB_PROCESSORS_LAST_REVIEWED = "May 30, 2026";

export type SubProcessor = {
  name: string;
  service: string;
  region: string;
};

export const SUB_PROCESSORS: SubProcessor[] = [
  {
    name: "Supabase",
    service: "Database, authentication, and edge functions",
    region: "Canada, United States",
  },
  {
    name: "Stripe",
    service:
      "Payment processing, saved cards via tokenization, deposit collection on behalf of restaurants",
    region: "Canada, United States",
  },
  {
    name: "OpenAI",
    service: "AI language understanding and vision (receipts)",
    region: "United States",
  },
  {
    name: "ElevenLabs",
    service: "Text-to-speech voice synthesis",
    region: "United States",
  },
  {
    name: "Deepgram",
    service: "Speech-to-text transcription",
    region: "United States",
  },
  {
    name: "Twilio",
    service: "SMS messaging and one-time passcodes",
    region: "United States",
  },
  {
    name: "Resend",
    service: "Transactional email",
    region: "United States, European Union",
  },
  {
    name: "Expo (EAS)",
    service: "Mobile app delivery and push notifications",
    region: "United States",
  },
  {
    name: "PostHog",
    service: "Product analytics and usage insights",
    region: "United States, European Union",
  },
  {
    name: "Sentry",
    service: "Error monitoring and crash reporting",
    region: "United States",
  },
  {
    name: "Amazon Web Services",
    service: "Web infrastructure and hosting",
    region: "United States",
  },
  {
    name: "Google LLC",
    service:
      "OAuth sign-in, Google Maps Platform, on-device speech (Android), Android push",
    region: "United States",
  },
  {
    name: "Apple Inc.",
    service: "Sign in with Apple, on-device speech (iOS), iOS push",
    region: "United States",
  },
];

/**
 * Creates or updates the Cenaiva assistant at Vapi.
 *
 * Usage (from apps/web):
 *   VAPI_API_KEY=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *     ELEVENLABS_VOICE_ID=... \
 *     tsx scripts/sync-vapi-assistant.ts
 *
 * On success the assistant id is printed to stdout — paste it into
 * `VITE_VAPI_ASSISTANT_ID` in your `.env`.
 */

import {
  buildCenaivaAssistantConfig,
  CENAIVA_ASSISTANT_NAME,
} from "../src/lib/vapi/assistant-config";

const VAPI_API_BASE = "https://api.vapi.ai";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const apiKey = requireEnv("VAPI_API_KEY");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const supabaseAnonKey = requireEnv("SUPABASE_ANON_KEY");
  const elevenLabsVoiceId = requireEnv("ELEVENLABS_VOICE_ID");
  const elevenLabsModelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5";

  const config = buildCenaivaAssistantConfig({
    supabaseUrl,
    supabaseAnonKey,
    elevenLabsVoiceId,
    elevenLabsModelId,
  });

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Look for an existing assistant named "Cenaiva" — avoids creating dupes
  // on every deploy.
  const listRes = await fetch(`${VAPI_API_BASE}/assistant`, { headers });
  if (!listRes.ok) {
    console.error(`Vapi list failed: ${listRes.status} ${await listRes.text()}`);
    process.exit(1);
  }
  const list = (await listRes.json()) as Array<{ id: string; name?: string }>;
  const existing = list.find((a) => a.name === CENAIVA_ASSISTANT_NAME);

  const target = existing
    ? `${VAPI_API_BASE}/assistant/${existing.id}`
    : `${VAPI_API_BASE}/assistant`;
  const method = existing ? "PATCH" : "POST";

  const res = await fetch(target, {
    method,
    headers,
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    console.error(`Vapi ${method} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const body = (await res.json()) as { id: string };
  console.log(`\n${existing ? "Updated" : "Created"} Vapi assistant: ${body.id}\n`);
  console.log(`Add this to apps/web/.env:\n  VITE_VAPI_ASSISTANT_ID=${body.id}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

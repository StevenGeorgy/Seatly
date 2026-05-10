// @ts-nocheck
// Shared OpenAI client + tunables. Previously cenaiva-orchestrate and
// cenaiva-small-prompt each instantiated their own OpenAI client and read
// the env separately, which led to drift on model names and pre-warm
// behavior. Importing from here is the single source of truth.

import OpenAI from "npm:openai@4";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

export const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
export const ORCHESTRATOR_MODEL =
  Deno.env.get("CENAIVA_ORCHESTRATOR_MODEL")?.trim() || "gpt-4o-mini";
export const SMALL_PROMPT_MODEL =
  Deno.env.get("CENAIVA_SMALL_PROMPT_MODEL")?.trim() || "gpt-4.1-nano";

// Sensible defaults; individual callers can override per-request.
export const SMALL_PROMPT_TEMPERATURE = 0.1;
export const SMALL_PROMPT_MAX_TOKENS = 45;

// Construction is lazy via getOpenAI() because Deno cold-starts in some
// environments fail when the OpenAI module is imported with no key set.
let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (!cached) {
    cached = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  }
  return cached;
}

/**
 * Optional pre-warm. Caller decides when (typically gated on
 * CENAIVA_OPENAI_PREWARM=1) — we don't run it at module load because
 * cold-start network work can compete with the first live request.
 */
export async function prewarmOpenAI(): Promise<void> {
  try {
    await getOpenAI().models.list();
  } catch {
    // best-effort
  }
}

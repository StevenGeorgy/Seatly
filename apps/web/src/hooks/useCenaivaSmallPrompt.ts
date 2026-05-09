import { useCallback } from "react";
import type { BookingState } from "@cenaiva/assistant";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export type CenaivaSmallPromptResponse = {
  spoken_text: string;
  next_expected_input: "restaurant" | "party_size" | "date" | "time" | "confirmation";
  audio?: { audio_base64: string; audio_content_type?: string | null } | null;
};

export type CenaivaSmallPromptRequest = {
  transcript: string;
  booking: Pick<
    BookingState,
    "restaurant_id" | "restaurant_name" | "party_size" | "date" | "time"
  >;
  voice_id?: string | null;
};

type SmallPromptResult = {
  data: CenaivaSmallPromptResponse | null;
  error: string | null;
};

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

function parseSmallPromptResponse(payload: unknown): CenaivaSmallPromptResponse | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Partial<CenaivaSmallPromptResponse>;
  if (typeof value.spoken_text !== "string" || !value.spoken_text.trim()) return null;
  if (
    value.next_expected_input !== "restaurant" &&
    value.next_expected_input !== "party_size" &&
    value.next_expected_input !== "date" &&
    value.next_expected_input !== "time" &&
    value.next_expected_input !== "confirmation"
  ) {
    return null;
  }
  return {
    spoken_text: value.spoken_text.trim(),
    next_expected_input: value.next_expected_input,
    audio:
      value.audio &&
      typeof value.audio === "object" &&
      typeof value.audio.audio_base64 === "string" &&
      value.audio.audio_base64.trim()
        ? {
            audio_base64: value.audio.audio_base64,
            audio_content_type:
              typeof value.audio.audio_content_type === "string"
                ? value.audio.audio_content_type
                : null,
          }
        : null,
  };
}

export function useCenaivaSmallPrompt() {
  const send = useCallback(
    async (
      req: CenaivaSmallPromptRequest,
      opts?: { signal?: AbortSignal },
    ): Promise<SmallPromptResult> => {
      if (!isSupabaseConfigured()) return { data: null, error: "not_configured" };
      const token = await getBearerToken();
      if (!token) return { data: null, error: "not_authenticated" };

      try {
        const response = await fetch(
          `${getSupabaseProjectUrl()}/functions/v1/cenaiva-small-prompt`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: getSupabaseAnonKey(),
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(req),
            signal: opts?.signal,
          },
        );

        if (!response.ok) return { data: null, error: `http_${response.status}` };
        const json: unknown = await response.json();
        return { data: parseSmallPromptResponse(json), error: null };
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return { data: null, error: "timeout" };
        }
        return { data: null, error: String(err) };
      }
    },
    [],
  );

  /** Best-effort warm-up — fire a tiny prewarm POST and forget it. */
  const prewarm = useCallback((voiceId?: string | null): void => {
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const token = await getBearerToken();
      if (!token) return;
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 6_000);
      void fetch(`${getSupabaseProjectUrl()}/functions/v1/cenaiva-small-prompt`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: getSupabaseAnonKey(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          transcript: "Thanks",
          booking: {},
          voice_id: voiceId ?? undefined,
          prewarm: true,
        }),
        signal: controller.signal,
      })
        .catch(() => undefined)
        .finally(() => window.clearTimeout(timer));
    })();
  }, []);

  return { send, prewarm };
}

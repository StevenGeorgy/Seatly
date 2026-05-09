import { useCallback, useRef, useState } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { AssistantResponseType, OrchestratorRequestType } from "@cenaiva/assistant";
import { AssistantResponse } from "@cenaiva/assistant";

/** Hard cap on a single orchestrator call. The edge function runs up to 5
 *  tool-use iterations + a final JSON completion (gpt-4o chat), so a realistic
 *  worst-case is ~30–35s. 20s was aborting healthy requests and surfacing the
 *  client-side "Sorry, I didn't catch that" fallback on every chat prompt. */
const REQUEST_TIMEOUT_MS = 45_000;

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

export type LatencyTransport = "readable_stream" | "buffered_text" | "xhr_event_source";

/**
 * Optional callbacks for consuming the orchestrator's streamed SSE frames.
 * - onSpeechChunk: called for every sentence-boundary chunk the LLM produces.
 *   Use this to push text into the queued TTS player so audio starts playing
 *   while the orchestrator is still running its tool loop.
 * - onDiscardPendingSpeech: the model spoke text and then pivoted to a tool
 *   call — drop any chunks already queued so we don't speak superseded text.
 * - onTransport: invoked once when the underlying HTTP transport is known
 *   (today always 'readable_stream'). Used by the latency-budget hook to
 *   record per-turn transport selection.
 */
export interface SendCallbacks {
  onSpeechChunk?: (text: string) => void;
  onDiscardPendingSpeech?: () => void;
  onTransport?: (transport: LatencyTransport) => void;
}

export function useCenaivaOrchestrator() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Ref mirror of `error` so callers can read the most recent failure cause
  // synchronously right after `await send(...)` — without waiting for the next
  // React render to flush the setState.
  const lastErrorRef = useRef<string | null>(null);

  const recordError = useCallback((msg: string | null) => {
    lastErrorRef.current = msg;
    setError(msg);
  }, []);

  const send = useCallback(
    async (
      req: OrchestratorRequestType,
      callbacks?: SendCallbacks,
    ): Promise<AssistantResponseType | null> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      setLoading(true);
      recordError(null);

      try {
        const token = await getBearerToken();
        if (!token) {
          recordError("not_authenticated");
          return null;
        }

        const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/cenaiva-orchestrate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: getSupabaseAnonKey(),
            Accept: "text/event-stream",
          },
          body: JSON.stringify(req),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          // The orchestrator may still emit a JSON error body if it fails
          // before opening the stream. Try to parse a body for a useful error.
          let msg = `http_${res.status}`;
          try {
            const j = await res.json();
            if (j?.error) msg = j.error as string;
          } catch { /* not json */ }
          recordError(msg);
          return null;
        }

        // SSE parse loop. Frames are separated by blank lines. Each frame is
        // one or more `data: <json>` lines — we always emit a single line, so
        // we just split on \n\n and parse the JSON after `data: `.
        const reader = res.body.getReader();
        callbacks?.onTransport?.("readable_stream");
        const decoder = new TextDecoder();
        let buffer = "";
        let finalPayload: Record<string, unknown> | null = null;
        let streamErrorMsg: string | null = null;

        // Read until the stream ends or `final` / `error` arrives. We don't
        // bail early on `final` — the server closes the stream right after.
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let sepIdx: number;
          while ((sepIdx = buffer.indexOf("\n\n")) !== -1) {
            const rawFrame = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            const dataLine = rawFrame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            let frame: Record<string, unknown>;
            try {
              frame = JSON.parse(dataLine.slice(6));
            } catch {
              continue;
            }
            switch (frame.type) {
              case "speech_chunk":
                if (typeof frame.text === "string" && frame.text.length) {
                  callbacks?.onSpeechChunk?.(frame.text);
                }
                break;
              case "discard_pending_speech":
                callbacks?.onDiscardPendingSpeech?.();
                break;
              case "final":
                finalPayload = frame.payload as Record<string, unknown>;
                break;
              case "error":
                streamErrorMsg = (frame.message as string) ?? `http_${frame.status ?? 500}`;
                break;
            }
          }
        }

        if (streamErrorMsg) {
          recordError(streamErrorMsg);
          return null;
        }
        if (!finalPayload) {
          recordError("no_final_payload");
          return null;
        }

        // Validate with zod. Schema drift from the orchestrator (new intents,
        // missing optional fields) is expected in development — we fall
        // through with a best-effort cast so the flow keeps working instead
        // of spamming the console on every turn.
        const parsed = AssistantResponse.safeParse(finalPayload);
        if (!parsed.success) {
          return finalPayload as AssistantResponseType;
        }
        return parsed.data;
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          recordError("timeout");
          return null;
        }
        recordError(String(err));
        return null;
      } finally {
        window.clearTimeout(timeoutId);
        setLoading(false);
      }
    },
    [recordError],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /**
   * Fire a tiny `{ prewarm: true }` POST to wake the orchestrator's edge
   * runtime + warm OpenAI's connection pool before the user's first real
   * turn. Best-effort — never throws, never blocks.
   */
  const prewarm = useCallback(async (): Promise<void> => {
    if (!isSupabaseConfigured()) return;
    const token = await getBearerToken();
    if (!token) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6_000);
    void fetch(`${getSupabaseProjectUrl()}/functions/v1/cenaiva-orchestrate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: getSupabaseAnonKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prewarm: true }),
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timer));
  }, []);

  return { send, loading, error, lastErrorRef, cancel, prewarm };
}

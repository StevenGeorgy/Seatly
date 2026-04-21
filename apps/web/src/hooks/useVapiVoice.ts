import { useCallback, useEffect, useRef } from "react";
import Vapi from "@vapi-ai/web";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { AssistantResponseType } from "@cenaiva/assistant";

// These three env values are all the frontend needs. The assistant itself is
// pre-configured with cenaiva-orchestrate-vapi as its custom-llm provider, so
// we never have to wire the brain in from the client side.
const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY ?? "";
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID ?? "";

interface VapiVoiceCallbacks {
  /** Called with the envelope that cenaiva-orchestrate-vapi packs into its
   *  trailing `apply_ui_response` tool call. The AssistantProvider dispatches
   *  it via APPLY_RESPONSE and runs the same side-effect loop it does for the
   *  legacy (REST) path. */
  onResponse: (response: AssistantResponseType) => void;
}

/**
 * Thin wrapper around @vapi-ai/web that mirrors the surface of useCenaivaVoice
 * so AssistantProvider can choose between them at runtime via a feature flag.
 *
 * Vapi owns the full listen-think-speak cycle (WebRTC mic, Deepgram STT, VAD,
 * turn-taking, ElevenLabs TTS, barge-in). The client's only jobs are:
 *   1. Start the call when the orb is tapped / wake word fires.
 *   2. Stamp per-call context (booking_state, selected_restaurant_id, etc.)
 *      onto messages via `vapi.send({ type: "add-message" })` so the custom-llm
 *      endpoint always sees the freshest client truth.
 *   3. Dispatch the UI envelope from the trailing tool call to the store.
 *
 * Stop/close flows resolve cleanly because Vapi's `stop()` tears down the
 * Daily WebRTC session and emits `call-end`; we just sync voiceStatus to idle.
 */
export function useVapiVoice({ onResponse }: VapiVoiceCallbacks) {
  const { state, dispatch } = useAssistantStore();
  const vapiRef = useRef<Vapi | null>(null);
  const activeRef = useRef(false);
  const onResponseRef = useRef(onResponse);

  // Keep the callback fresh without re-subscribing event listeners on every
  // render of AssistantProvider.
  useEffect(() => {
    onResponseRef.current = onResponse;
  }, [onResponse]);

  // Lazily instantiate Vapi on first use. Constructing eagerly at module load
  // would boot a Daily.co runtime on every page — including /login — even if
  // the user never opens the assistant.
  const getVapi = useCallback((): Vapi | null => {
    if (!VAPI_PUBLIC_KEY) return null;
    if (vapiRef.current) return vapiRef.current;
    const vapi = new Vapi(VAPI_PUBLIC_KEY);

    vapi.on("call-start", () => {
      activeRef.current = true;
      dispatch({ type: "SET_VOICE_STATUS", status: "listening" });
    });

    vapi.on("speech-start", () => {
      // Assistant is speaking — a speech-start on the user's side cancels it;
      // Vapi handles that internally (barge-in). Here we flip status so the
      // orb shows the speaking ring.
      dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });
    });

    vapi.on("speech-end", () => {
      dispatch({ type: "SET_VOICE_STATUS", status: "listening" });
    });

    vapi.on("message", (msg: Record<string, unknown>) => {
      const type = msg.type as string | undefined;

      if (type === "transcript") {
        const role = msg.role as string | undefined;
        const transcriptType = msg.transcriptType as string | undefined;
        const transcript = (msg.transcript as string) ?? "";
        if (role === "user" && transcriptType === "partial") {
          dispatch({ type: "SET_INTERIM_TRANSCRIPT", text: transcript });
        }
      }

      if (type === "speech-update") {
        const status = msg.status as string | undefined;
        if (status === "started") {
          dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });
        } else if (status === "stopped") {
          dispatch({ type: "SET_VOICE_STATUS", status: "listening" });
        }
      }

      if (type === "conversation-update") {
        // Fires after every assistant turn. Use it to surface the LLM's spoken
        // text into the caption bubble — the orchestrator already populated
        // the UI envelope via tool_calls below, but the caption needs a string.
        const conv = msg.conversation as Array<{ role?: string; content?: string }> | undefined;
        const lastAssistant = conv?.slice().reverse().find((m) => m.role === "assistant" && m.content);
        if (lastAssistant?.content) {
          dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: lastAssistant.content });
        }
      }

      if (type === "tool-calls" || type === "function-call") {
        // cenaiva-orchestrate-vapi packs the UI envelope into a synthetic
        // `apply_ui_response` tool call. Vapi forwards tool calls here before
        // (or in parallel with) executing them server-side; we use it purely
        // as a side-channel to drive the React store.
        const calls =
          (msg.toolCallList as Array<Record<string, unknown>> | undefined) ??
          (msg.toolCalls as Array<Record<string, unknown>> | undefined) ??
          (msg.functionCall ? [msg.functionCall] : []);
        for (const call of calls ?? []) {
          const c = call as Record<string, unknown>;
          const fn = ((c.function as Record<string, unknown> | undefined) ?? c) as Record<string, unknown>;
          const name = fn.name as string | undefined;
          if (name !== "apply_ui_response") continue;
          const rawArgs = fn.arguments as string | Record<string, unknown> | undefined;
          try {
            const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
            if (parsed) onResponseRef.current(parsed as AssistantResponseType);
          } catch (err) {
            console.warn("[useVapiVoice] failed to parse UI envelope", err);
          }
        }
      }
    });

    vapi.on("call-end", () => {
      activeRef.current = false;
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
      dispatch({ type: "SET_INTERIM_TRANSCRIPT", text: "" });
    });

    vapi.on("error", (err: unknown) => {
      console.error("[useVapiVoice] error", err);
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    });

    vapiRef.current = vapi;
    return vapi;
  }, [dispatch]);

  // Build the per-call variables the orchestrator proxy needs. Passed via
  // assistantOverrides.variableValues so cenaiva-orchestrate-vapi can inject
  // them into the orchestrator request body on every turn of this call.
  const collectContext = useCallback(async (): Promise<Record<string, unknown>> => {
    const s = state;
    let accessToken: string | null = null;
    if (isSupabaseConfigured()) {
      const client = getSupabaseBrowserClient();
      const { data } = await client.auth.getSession();
      accessToken = data.session?.access_token ?? null;
    }
    return {
      access_token: accessToken,
      booking_state: {
        restaurant_id: s.booking.restaurant_id,
        party_size: s.booking.party_size,
        date: s.booking.date,
        time: s.booking.time,
        shift_id: s.booking.shift_id,
        slot_iso: s.booking.slot_iso,
        status: s.booking.status,
        confirmation_code: s.booking.confirmation_code,
        reservation_id: s.booking.reservation_id,
      },
      visible_restaurant_ids: s.map.marker_restaurant_ids,
      selected_restaurant_id: s.booking.restaurant_id,
      conversation_id: s.conversationId ?? undefined,
      has_saved_card: s.booking.has_saved_card,
      reservation_id: s.booking.reservation_id,
    };
  }, [state]);

  const start = useCallback(async () => {
    const vapi = getVapi();
    if (!vapi || !VAPI_ASSISTANT_ID) return false;
    if (activeRef.current) return true;
    try {
      const variableValues = await collectContext();
      await vapi.start(VAPI_ASSISTANT_ID, {
        variableValues: variableValues as Record<string, string | number | boolean>,
      });
      return true;
    } catch (err) {
      console.error("[useVapiVoice] start failed", err);
      return false;
    }
  }, [getVapi, collectContext]);

  const stop = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi || !activeRef.current) return;
    try {
      await vapi.stop();
    } catch { /* ignore */ }
    activeRef.current = false;
  }, []);

  // Push a text message into the active call (used for keyboard-mode input
  // while Vapi is running). Vapi will treat it as a fresh user turn.
  const sendText = useCallback((text: string) => {
    const vapi = vapiRef.current;
    if (!vapi || !activeRef.current || !text.trim()) return;
    vapi.send({
      type: "add-message",
      message: { role: "user", content: text.trim() },
      triggerResponseEnabled: true,
    });
  }, []);

  // Cleanup on unmount — never leak a Daily call object across page nav.
  useEffect(() => {
    return () => {
      const vapi = vapiRef.current;
      if (vapi) {
        try { void vapi.stop(); } catch { /* ignore */ }
      }
    };
  }, []);

  return {
    isAvailable: !!VAPI_PUBLIC_KEY && !!VAPI_ASSISTANT_ID,
    isActive: () => activeRef.current,
    start,
    stop,
    sendText,
  };
}

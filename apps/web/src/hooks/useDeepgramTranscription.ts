import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || import.meta.env.NEXT_PUBLIC_SUPABASE_URL || "";
const TOKEN_ENDPOINT = `${SUPABASE_URL}/functions/v1/deepgram-live-token`;

const DEEPGRAM_LISTEN_URL = "wss://api.deepgram.com/v1/listen";

// Mic constraints tuned for speech in noisy rooms. The browser's built-in
// WebRTC DSP (noise suppression + echo cancellation + AGC) removes a huge
// amount of steady-state background sound before the audio ever reaches
// Deepgram, and costs us nothing extra on the server side.
export const NOISE_ROBUST_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

// Query params tuned for robustness against continuous background noise.
// - model=nova-3: Deepgram's best-accuracy streaming model.
// - smart_format, punctuate: nicer transcripts for downstream LLM.
// - interim_results=true: required for utterance_end_ms.
// - endpointing=300: a short VAD-silence window so we finalise quickly.
// - utterance_end_ms=1200: word-gap based end-of-turn — docs call this out
//   as the right tool when continuous background sound keeps the VAD busy.
// - vad_events=true: surfaces a SpeechStarted event we can use to flip UI.
const LISTEN_QUERY: Record<string, string> = {
  model: "nova-3",
  language: "en-CA",
  smart_format: "true",
  punctuate: "true",
  interim_results: "true",
  endpointing: "300",
  utterance_end_ms: "1200",
  vad_events: "true",
  encoding: "linear16",
  sample_rate: "16000",
  channels: "1",
};

const WORKLET_URL = "/deepgram-pcm-worklet.js";

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function fetchDeepgramToken(): Promise<string | null> {
  const bearer = await getBearerToken();
  if (!bearer) return null;
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    // Silent — caller converts a null token into a graceful Web Speech fallback
    // so there's no value in console-warning on every mic press.
    return null;
  }
  const json = (await res.json()) as { access_token?: string };
  return json.access_token ?? null;
}

interface DeepgramTranscriptPayload {
  type: "Results" | "UtteranceEnd" | "SpeechStarted" | "Metadata";
  channel?: {
    alternatives?: Array<{ transcript?: string; confidence?: number }>;
  };
  is_final?: boolean;
  speech_final?: boolean;
}

/**
 * Streams the user's mic through Deepgram Listen and resolves when the user
 * stops talking (utterance-end or silence). Designed as a drop-in replacement
 * for `useCenaivaSpeech.startRecognition` when the Deepgram STT flag is on.
 */
export function useDeepgramTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const settledRef = useRef(false);
  const accumulatedRef = useRef("");
  const resolveRef = useRef<((t: string) => void) | null>(null);
  const rejectRef = useRef<((e: Error) => void) | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hard cap on a single recognition turn — prevents a hung socket from
  // holding the mic open forever if the server never sends UtteranceEnd.
  const TURN_TIMEOUT_MS = 30_000;
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const teardown = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
    if (socketRef.current) {
      try {
        if (socketRef.current.readyState === WebSocket.OPEN) {
          socketRef.current.send(JSON.stringify({ type: "CloseStream" }));
        }
        socketRef.current.close();
      } catch { /* ignore */ }
      socketRef.current = null;
    }
    if (workletRef.current) {
      try { workletRef.current.disconnect(); } catch { /* ignore */ }
      workletRef.current = null;
    }
    if (contextRef.current) {
      try { void contextRef.current.close(); } catch { /* ignore */ }
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const finish = useCallback((transcript: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const resolve = resolveRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    teardown();
    resolve?.(transcript.trim());
  }, [teardown]);

  const fail = useCallback((err: Error) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const reject = rejectRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    teardown();
    reject?.(err);
  }, [teardown]);

  const startRecognition = useCallback(async (): Promise<string> => {
    if (isRecording) return "";
    settledRef.current = false;
    accumulatedRef.current = "";

    const token = await fetchDeepgramToken();
    if (!token) throw new Error("deepgram-token-unavailable");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: NOISE_ROBUST_AUDIO_CONSTRAINTS,
      });
    } catch (err) {
      const msg = (err as Error)?.message ?? "";
      if (msg.includes("NotAllowed") || msg.includes("Permission")) {
        throw new Error("not-allowed");
      }
      throw err;
    }
    streamRef.current = stream;

    const AudioCtxCtor =
      (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    const context = new AudioCtxCtor();
    contextRef.current = context;
    try {
      await context.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      teardown();
      throw new Error("worklet-load-failed:" + ((err as Error)?.message ?? ""));
    }

    const source = context.createMediaStreamSource(stream);
    const worklet = new AudioWorkletNode(context, "pcm-worklet", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { targetSampleRate: 16000 },
    });
    workletRef.current = worklet;

    const qs = new URLSearchParams(LISTEN_QUERY).toString();
    const url = `${DEEPGRAM_LISTEN_URL}?${qs}`;
    // Browsers can't attach arbitrary headers to WebSocket, but Deepgram
    // accepts the token via the `Sec-WebSocket-Protocol` sub-protocol list.
    // Short-lived tokens minted by /v1/auth/grant use the `bearer` scheme;
    // long-lived project API keys use `token` — we're on the short-lived flow.
    const socket = new WebSocket(url, ["bearer", token]);
    socketRef.current = socket;
    socket.binaryType = "arraybuffer";

    worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(event.data);
      }
    };

    source.connect(worklet);

    socket.onopen = () => {
      setIsRecording(true);
      turnTimerRef.current = setTimeout(() => {
        finish(accumulatedRef.current);
      }, TURN_TIMEOUT_MS);
    };

    socket.onmessage = (event: MessageEvent) => {
      let msg: DeepgramTranscriptPayload;
      try {
        msg = JSON.parse(typeof event.data === "string" ? event.data : "{}");
      } catch { return; }

      if (msg.type === "UtteranceEnd") {
        finish(accumulatedRef.current);
        return;
      }

      if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript ?? "").trim();
        if (!text) return;
        if (msg.is_final) {
          accumulatedRef.current = accumulatedRef.current
            ? `${accumulatedRef.current} ${text}`
            : text;
          // speech_final is set by Deepgram's VAD endpointing. When we get it
          // in a quiet room it means the speaker is done — resolve.
          if (msg.speech_final) {
            finish(accumulatedRef.current);
          }
        }
      }
    };

    socket.onerror = () => {
      fail(new Error("deepgram-socket-error"));
    };

    socket.onclose = (evt) => {
      // If we haven't resolved yet, close means the server disconnected.
      // Honor whatever partial transcript we have rather than rejecting —
      // the caller will treat empty transcripts as "didn't catch that".
      if (!settledRef.current) {
        if (evt.code === 1008 || evt.code === 4001 || evt.code === 4008) {
          // auth / protocol failures — surface as an error so fallback kicks in
          fail(new Error(`deepgram-socket-closed-${evt.code}`));
        } else {
          finish(accumulatedRef.current);
        }
      }
    };

    return new Promise<string>((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
    });
  }, [isRecording, finish, fail, teardown]);

  const stopRecognition = useCallback(() => {
    if (settledRef.current) {
      teardown();
      return;
    }
    finish(accumulatedRef.current);
  }, [finish, teardown]);

  // Cleanup on unmount — never leave a mic stream or socket hanging.
  useEffect(() => () => teardown(), [teardown]);

  return {
    isRecording,
    startRecognition,
    stopRecognition,
    isSupported: typeof window !== "undefined" && !!window.AudioContext && !!window.WebSocket,
  };
}

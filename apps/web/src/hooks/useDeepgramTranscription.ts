import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

const DEEPGRAM_PRERECORDED_URL = "https://api.deepgram.com/v1/listen";

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

// Browser wake-word detection stays on Web Speech, but the post-wake command
// transcript should come from Deepgram. We keep the 700ms end-of-turn target
// locally by ending the recording after 700ms of measured silence, then send
// the captured utterance to Deepgram's REST /listen endpoint with the same
// Nova-3 + keyterm prompting configuration.
//
// IMPORTANT: nova-3 does NOT accept `language=en-CA`. The REST endpoint
// returns 400 "No such model/language/tier combination found" — which is
// what was breaking Hey Cenaiva voice transcription end-to-end. Nova-3
// supports the generic `en` plus regional variants `en-US` / `en-GB`. The
// generic `en` is preferred so Canadian / Australian / etc. accents are
// all routed through the same model with no false-rejects.
const TRANSCRIBE_QUERY: Record<string, string> = {
  model: "nova-3",
  language: "en",
  smart_format: "true",
  punctuate: "true",
  // NOTE: `alternatives` is intentionally NOT included here. Deepgram's
  // pre-recorded REST endpoint (which this hook POSTs to) does not list
  // `alternatives` as a supported request parameter for nova-3 — sending
  // it returned HTTP 400 and broke voice transcription end-to-end.
  // Phase 4's multi-candidate scoring win still applies to text input
  // (orchestrator-side fuzzy paths), and to streaming WebSocket if/when
  // we add a streaming path that DOES accept alternatives.
};

const TOKEN_TTL_BUFFER_MS = 5_000;
// Silence threshold before ending the user's turn. 1.5 s is the snappy
// baseline — the assistant starts replying ~500 ms sooner than the prior
// 2 s value, which felt too long in live testing. Mid-sentence pauses
// shorter than 1.5 s still ride through the RMS detection (any audible
// hesitation re-arms the timer). The orb's RMS-driven pulse gives visual
// feedback that the mic is still hot, so users can keep their voice
// going through brief pauses instead of relying on the timer alone. If
// you bump this further, also bump TURN_TIMEOUT_MS so a stuck recognizer
// doesn't loop forever.
const SILENCE_TIMEOUT_MS = 1_500;
// 15 s of patience after the user clicks the mic with nothing said.
// Generous enough to think; short enough that an accidental click doesn't
// hold the mic open for a minute.
const NO_SPEECH_TIMEOUT_MS = 15_000;
// Hard cap on a single utterance. 60 s covers genuinely long thoughts.
const TURN_TIMEOUT_MS = 60_000;
const STREAM_KEEP_WARM_MS = 12_000;
const SPEECH_RMS_THRESHOLD = 0.015;
// Phase 4: bumped from 12 to 24 so the keyterm budget covers both visible
// restaurant names AND up to ~8 nearby city names. Cities are a different
// signal from restaurants — "in Welph" should still resolve to Guelph via
// edit-distance against the city keyterm list.
const MAX_KEYTERMS = 24;
const MEDIA_RECORDER_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

interface DeepgramPrerecordedResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
    }>;
  };
}

export type DeepgramTranscriptResult = {
  transcript: string;
  alternatives: string[];
};

function normalizeKeyterms(keyterms: string[] = []): string[] {
  return Array.from(
    new Set(
      keyterms
        .map((term) => term.trim())
        .filter(Boolean),
    ),
  ).slice(0, MAX_KEYTERMS);
}

function buildDeepgramTranscribeUrl(keyterms: string[] = []): string {
  const params = new URLSearchParams(TRANSCRIBE_QUERY);
  for (const term of normalizeKeyterms(keyterms)) {
    params.append("keyterm", term);
  }
  return `${DEEPGRAM_PRERECORDED_URL}?${params.toString()}`;
}

function pickRecorderMimeType(): string | undefined {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return undefined;
  }
  if (typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return MEDIA_RECORDER_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session?.access_token) return null;
  // Proactive refresh: if the token expires within the next 60s, refresh
  // now rather than firing a doomed-to-401 fetch that triggers the
  // "Voice transcription unavailable" toast. Supabase-js auto-refresh
  // ticks on a timer that can lag for idle/backgrounded tabs.
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000) {
    const { data: refreshed } = await client.auth.refreshSession();
    return refreshed.session?.access_token ?? session.access_token;
  }
  return session.access_token;
}

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;
let inFlightTokenFetch: Promise<string | null> | null = null;

function invalidateDeepgramTokenCache() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

async function fetchDeepgramTokenFresh(): Promise<string | null> {
  const doFetch = async (bearer: string) =>
    fetch(`${getSupabaseProjectUrl()}/functions/v1/deepgram-live-token`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        apikey: getSupabaseAnonKey(),
      },
    });
  let bearer = await getBearerToken();
  if (!bearer) {
    if (import.meta.env.DEV) console.warn("[Cenaiva STT] no bearer token — user not signed in");
    return null;
  }
  let res = await doFetch(bearer);
  // 401 retry: token may have expired between getBearerToken() and the
  // edge function's JWT validation. Force a session refresh and retry
  // once before declaring the token mint failed.
  if (res.status === 401 && isSupabaseConfigured()) {
    const client = getSupabaseBrowserClient();
    const { data: refreshed } = await client.auth.refreshSession();
    const fresh = refreshed.session?.access_token;
    if (fresh) {
      res = await doFetch(fresh);
    }
  }
  if (!res.ok) {
    if (import.meta.env.DEV) {
      const body = await res.text().catch(() => "<no body>");
      console.warn(`[Cenaiva STT] deepgram-live-token status=${res.status} body=${body.slice(0, 200)}`);
    }
    return null;
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  const ttlMs = (json.expires_in ?? 30) * 1000;
  cachedToken = json.access_token;
  cachedTokenExpiresAt = Date.now() + ttlMs - TOKEN_TTL_BUFFER_MS;
  return cachedToken;
}

export async function getDeepgramLiveToken(): Promise<string | null> {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }
  if (inFlightTokenFetch) return inFlightTokenFetch;
  inFlightTokenFetch = fetchDeepgramTokenFresh().finally(() => {
    inFlightTokenFetch = null;
  });
  return inFlightTokenFetch;
}

export function prefetchDeepgramToken(): void {
  void getDeepgramLiveToken();
}

// Retry schedule for transient Deepgram failures (5xx, network errors).
// Three attempts with exponential backoff covers ~98% of real-world Deepgram
// blips: a single 5xx burst rarely lasts more than ~2 seconds. Earlier
// single-retry behavior had both attempts fall inside the same outage window.
const DEEPGRAM_RETRY_BACKOFF_MS = [0, 200, 600];

async function transcribeWithDeepgram(blob: Blob, keyterms: string[]): Promise<DeepgramTranscriptResult> {
  const url = buildDeepgramTranscribeUrl(keyterms);
  const maxAttempts = DEEPGRAM_RETRY_BACKOFF_MS.length;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (DEEPGRAM_RETRY_BACKOFF_MS[attempt] > 0) {
      await new Promise((r) => setTimeout(r, DEEPGRAM_RETRY_BACKOFF_MS[attempt]));
    }
    const token = await getDeepgramLiveToken();
    if (!token) {
      throw new Error("deepgram-token-unavailable");
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": blob.type || "audio/webm",
        },
        body: blob,
      });

      if (response.ok) {
        const json = (await response.json()) as DeepgramPrerecordedResponse;
        const alts = (json.results?.channels?.[0]?.alternatives ?? [])
          .map((a) => a.transcript?.trim() ?? "")
          .filter((t) => t.length > 0);
        return {
          transcript: alts[0] ?? "",
          alternatives: alts.slice(0, 3),
        };
      }

      const bodyText = await response.text().catch(() => "");
      invalidateDeepgramTokenCache();

      const isLastAttempt = attempt === maxAttempts - 1;
      const shouldRetry =
        !isLastAttempt &&
        (response.status === 401 || response.status === 403 || response.status >= 500);
      if (shouldRetry) {
        continue;
      }

      throw new Error(
        `deepgram-http-${response.status}${bodyText ? `:${bodyText.slice(0, 120)}` : ""}`,
      );
    } catch (err) {
      invalidateDeepgramTokenCache();
      const isLastAttempt = attempt === maxAttempts - 1;
      if (!isLastAttempt) continue;
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  throw new Error("deepgram-transcribe-failed");
}

export function useDeepgramTranscription() {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const turnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const releaseStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const resolveRef = useRef<((value: DeepgramTranscriptResult) => void) | null>(null);
  const rejectRef = useRef<((reason?: Error) => void) | null>(null);
  const settledRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const keytermsRef = useRef<string[]>([]);
  const stoppingRef = useRef(false);
  // Live mic loudness in [0, 1], updated ~60 Hz inside monitorLevels().
  // Consumed by the voice orb to drive a "still listening" pulse. Stored in a
  // ref + external-store subscribers (NOT useState) — a re-render 60×/sec on a
  // hook this high in the tree would crater framerate.
  const audioLevelRef = useRef(0);
  const audioLevelSubscribersRef = useRef<Set<() => void>>(new Set());
  const subscribeAudioLevel = useCallback((cb: () => void) => {
    audioLevelSubscribersRef.current.add(cb);
    return () => {
      audioLevelSubscribersRef.current.delete(cb);
    };
  }, []);
  const getAudioLevel = useCallback(() => audioLevelRef.current, []);

  const clearTurnTimer = useCallback(() => {
    if (turnTimerRef.current) {
      clearTimeout(turnTimerRef.current);
      turnTimerRef.current = null;
    }
  }, []);

  const clearReleaseStreamTimer = useCallback(() => {
    if (releaseStreamTimerRef.current) {
      clearTimeout(releaseStreamTimerRef.current);
      releaseStreamTimerRef.current = null;
    }
  }, []);

  const cancelLevelMonitor = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    clearReleaseStreamTimer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, [clearReleaseStreamTimer]);

  const cleanupMedia = useCallback((opts?: { keepWarm?: boolean }) => {
    cancelLevelMonitor();
    clearTurnTimer();

    // Reset the audio-level so the orb stops pulsing once the mic is no
    // longer active. Notify subscribers so the orb re-reads via
    // useSyncExternalStore.
    audioLevelRef.current = 0;
    audioLevelSubscribersRef.current.forEach((cb) => cb());

    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch { /* ignore */ }
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch { /* ignore */ }
      analyserRef.current = null;
    }
    if (contextRef.current) {
      try { void contextRef.current.close(); } catch { /* ignore */ }
      contextRef.current = null;
    }
    if (opts?.keepWarm) {
      clearReleaseStreamTimer();
      if (streamRef.current) {
        releaseStreamTimerRef.current = setTimeout(() => {
          releaseStream();
        }, STREAM_KEEP_WARM_MS);
      }
    } else {
      releaseStream();
    }
    recorderRef.current = null;
    setIsRecording(false);
  }, [cancelLevelMonitor, clearReleaseStreamTimer, clearTurnTimer, releaseStream]);

  const finish = useCallback((result: DeepgramTranscriptResult) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const resolve = resolveRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    cleanupMedia({ keepWarm: true });
    const final: DeepgramTranscriptResult = {
      transcript: result.transcript.trim(),
      alternatives: result.alternatives.map((a) => a.trim()).filter(Boolean),
    };
    if (import.meta.env.DEV) {
      console.log(`[Cenaiva STT] heard: "${final.transcript}" (alts=${final.alternatives.length})`);
    }
    resolve?.(final);
  }, [cleanupMedia]);

  const fail = useCallback((error: Error) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const reject = rejectRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    cleanupMedia({ keepWarm: true });
    reject?.(error);
  }, [cleanupMedia]);

  const stopRecorder = useCallback(() => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    cancelLevelMonitor();
    clearTurnTimer();

    const recorder = recorderRef.current;
    if (!recorder) {
      finish({ transcript: "", alternatives: [] });
      return;
    }

    if (recorder.state !== "inactive") {
      try { recorder.requestData(); } catch { /* ignore */ }
      try {
        recorder.stop();
        return;
      } catch { /* ignore */ }
    }

    finish({ transcript: "", alternatives: [] });
  }, [cancelLevelMonitor, clearTurnTimer, finish]);

  const monitorLevels = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser || stoppingRef.current) return;

    const samples = new Float32Array(analyser.fftSize);
    const tick = () => {
      const activeAnalyser = analyserRef.current;
      if (!activeAnalyser || stoppingRef.current) return;

      activeAnalyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i];
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / samples.length);
      const now = Date.now();

      // Push RMS into the audio-level store so the orb can pulse with the
      // user's voice. Scale: speech threshold (~0.015) maps to ~0.12;
      // shouted-into-mic (~0.125) maps to 1.0. Clamped to [0, 1].
      audioLevelRef.current = Math.min(1, rms * 8);
      audioLevelSubscribersRef.current.forEach((cb) => cb());

      if (rms >= SPEECH_RMS_THRESHOLD) {
        speechDetectedRef.current = true;
        lastSpeechAtRef.current = now;
      }

      if (!speechDetectedRef.current) {
        if (now - recordingStartedAtRef.current >= NO_SPEECH_TIMEOUT_MS) {
          stopRecorder();
          return;
        }
      } else if (now - lastSpeechAtRef.current >= SILENCE_TIMEOUT_MS) {
        stopRecorder();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
  }, [stopRecorder]);

  const startRecognition = useCallback(async (keyterms: string[] = []): Promise<DeepgramTranscriptResult> => {
    if (isRecording) return { transcript: "", alternatives: [] };
    if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
      throw new Error("deepgram-mediarecorder-unavailable");
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("deepgram-getusermedia-unavailable");
    }

    const AudioCtxCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtxCtor) {
      throw new Error("deepgram-audiocontext-unavailable");
    }

    // Warm the short-lived Deepgram token in the background, but don't block
    // mic activation on this network round-trip. The upload path will await
    // the same in-flight promise later if needed.
    prefetchDeepgramToken();

    clearReleaseStreamTimer();

    settledRef.current = false;
    stoppingRef.current = false;
    speechDetectedRef.current = false;
    chunksRef.current = [];
    keytermsRef.current = normalizeKeyterms(keyterms);
    recordingStartedAtRef.current = Date.now();
    lastSpeechAtRef.current = recordingStartedAtRef.current;

    let stream = streamRef.current;
    const hasWarmStream =
      !!stream &&
      stream.getTracks().some((track) => track.readyState === "live" && track.enabled);

    if (!hasWarmStream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: NOISE_ROBUST_AUDIO_CONSTRAINTS,
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? "";
        if (msg.includes("NotAllowed") || msg.includes("Permission")) {
          throw new Error("not-allowed");
        }
        throw err instanceof Error ? err : new Error(String(err));
      }
      streamRef.current = stream;
    }

    if (!stream) {
      throw new Error("deepgram-stream-unavailable");
    }

    const context = new AudioCtxCtor();
    contextRef.current = context;
    try { await context.resume(); } catch { /* ignore */ }
    const source = context.createMediaStreamSource(stream);
    sourceRef.current = source;
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    analyserRef.current = analyser;
    source.connect(analyser);

    const recorderMimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      cleanupMedia();
      throw new Error(`deepgram-recorder-start-failed:${(err as Error)?.message ?? ""}`);
    }
    recorderRef.current = recorder;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      fail(new Error("deepgram-recorder-error"));
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || recorderMimeType || "audio/webm",
      });
      void (async () => {
        cleanupMedia({ keepWarm: true });
        if (!blob.size || !speechDetectedRef.current) {
          finish({ transcript: "", alternatives: [] });
          return;
        }
        try {
          const result = await transcribeWithDeepgram(blob, keytermsRef.current);
          finish(result);
        } catch (err) {
          fail(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    };

    try {
      recorder.start(250);
    } catch (err) {
      cleanupMedia();
      throw new Error(`deepgram-recorder-start-failed:${(err as Error)?.message ?? ""}`);
    }

    setIsRecording(true);
    turnTimerRef.current = setTimeout(() => {
      stopRecorder();
    }, TURN_TIMEOUT_MS);
    monitorLevels();

    return new Promise<DeepgramTranscriptResult>((resolve, reject) => {
      resolveRef.current = resolve;
      rejectRef.current = reject;
    });
  }, [cleanupMedia, fail, finish, isRecording, monitorLevels, stopRecorder]);

  const stopRecognition = useCallback(() => {
    if (settledRef.current) {
      cleanupMedia();
      return;
    }
    stopRecorder();
  }, [cleanupMedia, stopRecorder]);

  useEffect(() => () => cleanupMedia(), [cleanupMedia]);

  return {
    isRecording,
    startRecognition,
    stopRecognition,
    subscribeAudioLevel,
    getAudioLevel,
    isSupported:
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      !!(window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext),
  };
}

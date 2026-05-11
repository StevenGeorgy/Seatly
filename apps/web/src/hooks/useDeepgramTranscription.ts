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
};

const TOKEN_TTL_BUFFER_MS = 5_000;
// Silence threshold before ending the user's turn. 700 ms was aggressive —
// natural pauses mid-sentence ("I would like to book… for me and my boy")
// crossed it and Deepgram split the utterance into two turns. 1.5 s is more
// forgiving without making turn-taking feel laggy. If you bump this further,
// also bump TURN_TIMEOUT_MS so a stuck recognizer doesn't loop forever.
const SILENCE_TIMEOUT_MS = 1_500;
const NO_SPEECH_TIMEOUT_MS = 5_000;
const TURN_TIMEOUT_MS = 30_000;
const STREAM_KEEP_WARM_MS = 12_000;
const SPEECH_RMS_THRESHOLD = 0.015;
const MAX_KEYTERMS = 12;
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
  return data.session?.access_token ?? null;
}

let cachedToken: string | null = null;
let cachedTokenExpiresAt = 0;
let inFlightTokenFetch: Promise<string | null> | null = null;

function invalidateDeepgramTokenCache() {
  cachedToken = null;
  cachedTokenExpiresAt = 0;
}

async function fetchDeepgramTokenFresh(): Promise<string | null> {
  const bearer = await getBearerToken();
  if (!bearer) return null;
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/deepgram-live-token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      apikey: getSupabaseAnonKey(),
    },
  });
  if (!res.ok) {
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

async function transcribeWithDeepgram(blob: Blob, keyterms: string[]): Promise<string> {
  const url = buildDeepgramTranscribeUrl(keyterms);

  for (let attempt = 0; attempt < 2; attempt += 1) {
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
        return json.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? "";
      }

      const bodyText = await response.text().catch(() => "");
      invalidateDeepgramTokenCache();

      const shouldRetry =
        attempt === 0 &&
        (response.status === 401 || response.status === 403 || response.status >= 500);
      if (shouldRetry) {
        continue;
      }

      throw new Error(
        `deepgram-http-${response.status}${bodyText ? `:${bodyText.slice(0, 120)}` : ""}`,
      );
    } catch (err) {
      invalidateDeepgramTokenCache();
      if (attempt === 0) continue;
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
  const resolveRef = useRef<((value: string) => void) | null>(null);
  const rejectRef = useRef<((reason?: Error) => void) | null>(null);
  const settledRef = useRef(false);
  const speechDetectedRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const keytermsRef = useRef<string[]>([]);
  const stoppingRef = useRef(false);

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

  const finish = useCallback((transcript: string) => {
    if (settledRef.current) return;
    settledRef.current = true;
    const resolve = resolveRef.current;
    resolveRef.current = null;
    rejectRef.current = null;
    cleanupMedia({ keepWarm: true });
    const final = transcript.trim();
    if (import.meta.env.DEV) {
      console.log(`[Cenaiva STT] heard: "${final}"`);
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
      finish("");
      return;
    }

    if (recorder.state !== "inactive") {
      try { recorder.requestData(); } catch { /* ignore */ }
      try {
        recorder.stop();
        return;
      } catch { /* ignore */ }
    }

    finish("");
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

  const startRecognition = useCallback(async (keyterms: string[] = []): Promise<string> => {
    if (isRecording) return "";
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
          finish("");
          return;
        }
        try {
          const transcript = await transcribeWithDeepgram(blob, keytermsRef.current);
          finish(transcript);
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

    return new Promise<string>((resolve, reject) => {
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
    isSupported:
      typeof window !== "undefined" &&
      typeof MediaRecorder !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      !!(window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext),
  };
}

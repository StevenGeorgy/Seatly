import { useCallback, useRef, useState } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

async function fetchTTSBlob(text: string, voiceId?: string): Promise<Blob | null> {
  const token = await getBearerToken();
  if (!token) return null;
  try {
    const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/elevenlabs-tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        apikey: getSupabaseAnonKey(),
      },
      body: JSON.stringify({ text, voice_id: voiceId }),
    });
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

export function useElevenLabsTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  // Reuse ONE HTMLAudioElement across every speak() call. Creating a fresh
  // `new Audio(url)` each turn was the biggest source of TTS flakiness:
  // Chrome's autoplay policy attaches the "unmuted" grant to a specific
  // element, and a new one sometimes starts muted or stalls on first play
  // → fallback to Web Speech → user hears a different voice randomly.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  // ── Queued streaming TTS state ───────────────────────────────────────────
  // Each speakQueued() call kicks off its blob fetch *immediately* (so the
  // network round-trip overlaps with prior playback) and pushes a Promise<Blob>
  // onto the queue. The player loop pulls the next promise, awaits it, then
  // plays the resulting blob on the shared audioRef element. This delivers
  // gap-free phone-call-style playback while letting the orchestrator keep
  // streaming sentences. `queueGenerationRef` lets stop() / discard make in-
  // flight loops abandon their work without races.
  const queueRef = useRef<Promise<Blob | null>[]>([]);
  const playerRunningRef = useRef(false);
  const queueGenerationRef = useRef(0);
  const queueResolversRef = useRef<Array<() => void>>([]);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const a = new Audio();
      a.preload = "auto";
      audioRef.current = a;
    }
    return audioRef.current;
  }, []);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      // Intentionally don't null out the element — we reuse it.
      try { audioRef.current.currentTime = 0; } catch { /* noop */ }
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    // Invalidate any in-flight queued playback.
    queueGenerationRef.current++;
    queueRef.current = [];
    // Resolve any drainQueue() promises waiting on us.
    for (const r of queueResolversRef.current) r();
    queueResolversRef.current = [];
    playerRunningRef.current = false;
    setIsSpeaking(false);
  }, []);

  const playBlobOnce = useCallback(
    (blob: Blob): Promise<void> =>
      new Promise<void>((resolve) => {
        const url = URL.createObjectURL(blob);
        blobUrlRef.current = url;
        const audio = getAudio();
        audio.src = url;
        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          if (blobUrlRef.current === url) {
            URL.revokeObjectURL(url);
            blobUrlRef.current = null;
          }
        };
        audio.onended = () => { cleanup(); resolve(); };
        audio.onerror = () => { cleanup(); resolve(); };
        audio.play().catch(() => { cleanup(); resolve(); });
      }),
    [getAudio],
  );

  const runPlayer = useCallback(async (gen: number) => {
    if (playerRunningRef.current) return;
    playerRunningRef.current = true;
    setIsSpeaking(true);
    try {
      while (queueRef.current.length > 0) {
        if (queueGenerationRef.current !== gen) return;
        const next = queueRef.current.shift()!;
        const blob = await next;
        if (queueGenerationRef.current !== gen) return;
        if (!blob) continue; // fetch failed → skip this chunk
        await playBlobOnce(blob);
      }
    } finally {
      // Only flip speaking off if we still own this generation. A concurrent
      // stop() bumps the generation and already cleared the flag.
      if (queueGenerationRef.current === gen) {
        playerRunningRef.current = false;
        setIsSpeaking(false);
      }
      // Wake any drainQueue() awaiters now that the queue is empty.
      const resolvers = queueResolversRef.current;
      queueResolversRef.current = [];
      for (const r of resolvers) r();
    }
  }, [playBlobOnce]);

  /**
   * Enqueue a sentence-sized chunk for streamed playback. Fetches the MP3
   * blob immediately so the network call overlaps with playback of any
   * preceding chunks. Safe to call repeatedly while audio is already playing.
   */
  const speakQueued = useCallback(
    (text: string, voiceId?: string) => {
      if (!text.trim()) return;
      const gen = queueGenerationRef.current;
      queueRef.current.push(fetchTTSBlob(text, voiceId));
      // Kick off the player loop if it isn't running. If it is, the new
      // promise will get picked up on the next iteration.
      if (!playerRunningRef.current) {
        void runPlayer(gen);
      }
    },
    [runPlayer],
  );

  /**
   * Drop any chunks currently queued AND any in-flight fetches. Use when the
   * orchestrator emits `discard_pending_speech` because the model pivoted
   * from a chatty reply to a tool call.
   */
  const discardQueued = useCallback(() => {
    queueGenerationRef.current++;
    queueRef.current = [];
    if (audioRef.current) {
      audioRef.current.pause();
      try { audioRef.current.currentTime = 0; } catch { /* noop */ }
    }
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    playerRunningRef.current = false;
    setIsSpeaking(false);
  }, []);

  /**
   * Resolves once every queued chunk has finished playing (or the queue was
   * drained by stop()/discard). Used by the assistant flow to know when it
   * is safe to re-open the mic for the next turn.
   */
  const drainQueue = useCallback(
    (): Promise<void> =>
      new Promise<void>((resolve) => {
        if (!playerRunningRef.current && queueRef.current.length === 0) {
          resolve();
          return;
        }
        queueResolversRef.current.push(resolve);
      }),
    [],
  );

  const speak = useCallback(
    async (text: string, voiceId?: string): Promise<boolean> => {
      stop();

      const blob = await fetchTTSBlob(text, voiceId);
      if (!blob) return false;

      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;

      const audio = getAudio();
      audio.src = url;

      setIsSpeaking(true);

      let played = false;
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          audio.onended = null;
          audio.onerror = null;
          if (blobUrlRef.current === url) {
            URL.revokeObjectURL(url);
            blobUrlRef.current = null;
          }
        };
        audio.onended = () => {
          played = true;
          setIsSpeaking(false);
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          cleanup();
          resolve();
        };
        audio.play().catch(() => {
          setIsSpeaking(false);
          cleanup();
          resolve();
        });
      });
      return played;
    },
    [stop, getAudio],
  );

  return { speak, speakQueued, discardQueued, drainQueue, stop, isSpeaking };
}

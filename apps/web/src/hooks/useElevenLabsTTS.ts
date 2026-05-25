import { useCallback, useEffect, useRef, useState } from "react";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";

// ── Persistent TTS cache (IndexedDB) ─────────────────────────────────────────
//
// Common assistant phrases ("One moment please.", "How many guests?", etc.)
// are spoken on hundreds of turns per user. Caching the MP3 blob in
// IndexedDB by `${voiceId}:${normalizedText}` cuts the very-first-frame
// latency on those phrases from ~300–500 ms (network → ElevenLabs → blob)
// to single-digit ms (IDB read → blob URL).
//
// The version suffix is bumped any time the upstream model / format
// (codec, bitrate, sampling rate) changes — it forces a fresh fetch instead
// of replaying stale audio. Mirror of mobile's useMobileTTS cache key.

const TTS_CACHE_VERSION = "flash25-mp3-44100-128-v1";
const TTS_DB_NAME = "cenaivaTtsCache";
const TTS_DB_STORE = "phrases";

const COMMON_TTS_CACHE_TEXTS: ReadonlyArray<string> = [
  "One moment please.",
  "What restaurant or area should I book?",
  "How many guests?",
  "What date and time should I book?",
  "What date should I book?",
  "What time should I book?",
  "I could not reach live availability. Try another date and time, or ask for the restaurant hours.",
  "Something went wrong. Try again.",
  "Please sign in to continue.",
  // Perf P10: high-frequency orchestrator replies. Each cached phrase saves
  // the ~300-500ms ElevenLabs round-trip on its first spoken use, falling
  // back to live fetch if the user hits a phrase outside this set.
  "Got it.",
  "Which restaurant?",
  "No tables at that time.",
  "Sorry, I didn't catch that. Try again.",
  "Tap the mic to start when ready.",
  "Checking availability now.",
  "Looking that up.",
  "Did you mean this one?",
  "Should I book it?",
];

function djb2Hash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

function cacheKey(voiceId: string | null | undefined, text: string): string {
  const normalized = text.trim().toLowerCase();
  const voiceKey = voiceId ?? "default";
  return `${TTS_CACHE_VERSION}-${djb2Hash(`${voiceKey}:${normalized}`)}`;
}

function openTtsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(TTS_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(TTS_DB_STORE)) {
          db.createObjectStore(TTS_DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCachedBlob(
  voiceId: string | null | undefined,
  text: string,
): Promise<Blob | null> {
  const db = await openTtsDb();
  if (!db) return null;
  return await new Promise<Blob | null>((resolve) => {
    try {
      const tx = db.transaction(TTS_DB_STORE, "readonly");
      const store = tx.objectStore(TTS_DB_STORE);
      const req = store.get(cacheKey(voiceId, text));
      req.onsuccess = () => {
        const value: unknown = req.result;
        resolve(value instanceof Blob ? value : null);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCachedBlob(
  voiceId: string | null | undefined,
  text: string,
  blob: Blob,
): Promise<void> {
  const db = await openTtsDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TTS_DB_STORE, "readwrite");
      const store = tx.objectStore(TTS_DB_STORE);
      store.put(blob, cacheKey(voiceId, text));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function getBearerToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const client = getSupabaseBrowserClient();
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session?.access_token) return null;
  // Proactive refresh: if the token expires within the next 60s, refresh
  // now rather than firing a doomed-to-401 fetch. Supabase-js auto-refresh
  // ticks on a timer that can lag a few seconds; for idle tabs that just
  // came back into focus this avoids the "Voice transcription unavailable"
  // toast that fires when ElevenLabs/Deepgram 401 due to a stale token.
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (expiresAtMs > 0 && expiresAtMs - Date.now() < 60_000) {
    const { data: refreshed } = await client.auth.refreshSession();
    return refreshed.session?.access_token ?? session.access_token;
  }
  return session.access_token;
}

// Track which non-200 status codes we've already warned about so a long
// outage doesn't dump the same warning into the console hundreds of times
// per minute. Reset on successful fetch (next 200 clears the set).
const warnedStatuses = new Set<number>();

async function fetchTTSBlob(text: string, voiceId?: string): Promise<Blob | null> {
  // Cache hit → no network. Wraps in try/catch for safety; IDB rejecting
  // (private mode, quota) just routes us to the live fetch path.
  try {
    const cached = await readCachedBlob(voiceId, text);
    if (cached) return cached;
  } catch {
    /* fall through to live fetch */
  }

  let token = await getBearerToken();
  if (!token) {
    if (!warnedStatuses.has(401)) {
      console.warn("[Cenaiva TTS] no bearer token — user not signed in; skipping ElevenLabs");
      warnedStatuses.add(401);
    }
    return null;
  }
  try {
    const doFetch = (bearer: string) =>
      fetch(`${getSupabaseProjectUrl()}/functions/v1/elevenlabs-tts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
          apikey: getSupabaseAnonKey(),
        },
        body: JSON.stringify({ text, voice_id: voiceId }),
      });
    let res = await doFetch(token);
    // 401 retry: token may have expired between getBearerToken() above
    // and edge-function validation. Force a session refresh and try once
    // more before falling back to Web Speech. Without this, idle/
    // backgrounded tabs that just came back into focus would silently
    // route every utterance through the OS voice for ~minutes until the
    // session auto-refresh ticker caught up.
    if (res.status === 401 && isSupabaseConfigured()) {
      const client = getSupabaseBrowserClient();
      const { data: refreshed } = await client.auth.refreshSession();
      const fresh = refreshed.session?.access_token;
      if (fresh) {
        token = fresh;
        res = await doFetch(fresh);
      }
    }
    if (!res.ok) {
      // In dev: ALWAYS log every failure with the body so we can debug
      // intermittent failures. In prod: dedupe per-status to avoid spam.
      if (import.meta.env.DEV) {
        const body = await res.text().catch(() => "<no body>");
        console.warn(`[Cenaiva TTS] /elevenlabs-tts status=${res.status} (${res.statusText}) — body: ${body.slice(0, 200)}`);
      } else if (!warnedStatuses.has(res.status)) {
        console.warn(`[Cenaiva TTS] /elevenlabs-tts status=${res.status} (${res.statusText}) — falling back`);
        warnedStatuses.add(res.status);
      }
      return null;
    }
    // Successful fetch clears the warn-once set so a recovered service can
    // emit a fresh warning if it later regresses.
    if (warnedStatuses.size > 0) warnedStatuses.clear();
    const blob = await res.blob();
    // Best-effort cache write — never block playback on it.
    if (COMMON_TTS_CACHE_TEXTS.includes(text)) {
      void writeCachedBlob(voiceId, text, blob);
    }
    return blob;
  } catch (err) {
    if (!warnedStatuses.has(0)) {
      console.warn("[Cenaiva TTS] /elevenlabs-tts fetch threw — network or DNS issue", err);
      warnedStatuses.add(0);
    }
    return null;
  }
}

export type UseElevenLabsTTSOptions = {
  voiceId?: string | null;
};

export function useElevenLabsTTS(options?: UseElevenLabsTTSOptions) {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const voiceIdRef = useRef<string | null | undefined>(options?.voiceId ?? null);
  useEffect(() => {
    voiceIdRef.current = options?.voiceId ?? null;
  }, [options?.voiceId]);
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
  // Tracks in-flight primeCache runs per voiceId so multiple gestures (page
  // load + pointerdown + mic-click + send) don't each kick off a fresh 18-item
  // prefetch and blow the per-user rate limit. (2026-05-16)
  const primeInFlightRef = useRef<Set<string>>(new Set());

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
      const effectiveVoiceId = voiceId ?? voiceIdRef.current ?? undefined;
      const gen = queueGenerationRef.current;
      queueRef.current.push(fetchTTSBlob(text, effectiveVoiceId));
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

      const effectiveVoiceId = voiceId ?? voiceIdRef.current ?? undefined;
      const blob = await fetchTTSBlob(text, effectiveVoiceId);
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

  /**
   * Warm the IndexedDB cache for the current voiceId × all common phrases.
   * Sequential, non-blocking — silently no-ops if the user gesture / token
   * isn't ready yet. Re-callable; phrases already cached are skipped by
   * `fetchTTSBlob` itself before the network is touched.
   */
  const primeCache = useCallback(async (): Promise<void> => {
    const voiceId = voiceIdRef.current ?? undefined;
    // 1) Single-flight guard: if a prime is already in progress for this
    //    voice, don't kick off a second one. AssistantProvider calls
    //    primeTTS() from multiple gestures (pointerdown, open, sendTranscript)
    //    and each gesture used to fire 18 sequential ElevenLabs requests.
    //    With 60/min server-side rate limit, that broke voice for the rest
    //    of the minute. (2026-05-16 rate-limit fix)
    const primeKey = `${voiceId ?? "default"}`;
    if (primeInFlightRef.current.has(primeKey)) return;
    primeInFlightRef.current.add(primeKey);
    try {
      // 2) Check ALL items first via Promise.all (parallel IDB reads are
      //    cheap and don't hit the network).
      const missing: string[] = [];
      await Promise.all(
        COMMON_TTS_CACHE_TEXTS.map(async (text) => {
          try {
            const cached = await readCachedBlob(voiceId, text);
            if (!cached) missing.push(text);
          } catch {
            missing.push(text);
          }
        }),
      );
      if (missing.length === 0) return;
      // 3) Throttle uncached fetches — ~250ms between each, so 18 items take
      //    ~4.5s spread out instead of slamming the rate limit in 1 second.
      //    Abort the whole loop if a fetch returns null (no token / 401 /
      //    network error): one failure means the rest will fail too, so
      //    don't spam the network panel with 17 more doomed requests.
      for (const text of missing) {
        const blob = await fetchTTSBlob(text, voiceId);
        if (!blob) return;
        await new Promise((r) => setTimeout(r, 250));
      }
    } finally {
      primeInFlightRef.current.delete(primeKey);
    }
  }, []);

  // Re-warm the cache when the voiceId changes. Gate on a settled auth
  // state so we don't fire during the page-load race window where the
  // supabase session is still hydrating from localStorage — those calls
  // 401 on the server and flood the network panel with ~18 doomed
  // requests right after every login.
  const { user, loading: authLoading } = useUser();
  useEffect(() => {
    if (!options?.voiceId) return;
    if (authLoading || !user) return;
    void primeCache();
  }, [options?.voiceId, primeCache, authLoading, user]);

  return { speak, speakQueued, discardQueued, drainQueue, stop, isSpeaking, primeCache };
}

import { useCallback, useRef, useState } from "react";
import { useCenaivaSpeech } from "@/hooks/useCenaivaSpeech";
import { useDeepgramTranscription } from "@/hooks/useDeepgramTranscription";
import { useElevenLabsTTS } from "@/hooks/useElevenLabsTTS";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useCenaivaVoicePreference } from "@/hooks/useCenaivaVoicePreference";

// When not explicitly disabled, route command voice input through Deepgram's
// Nova transcription path. Browser STT fallback is intentionally disabled so
// Cenaiva never routes command recognition through Web Speech.
const DEEPGRAM_ENABLED = import.meta.env.VITE_DEEPGRAM_STT_ENABLED !== "false";

export function useCenaivaVoice() {
  const { dispatch, state } = useAssistantStore();
  const voicePref = useCenaivaVoicePreference();
  const speech = useCenaivaSpeech();
  const deepgram = useDeepgramTranscription();
  const elevenlabs = useElevenLabsTTS({ voiceId: voicePref.voiceId });

  const elEnabledFlag = import.meta.env.VITE_ELEVENLABS_ENABLED !== "false";
  const listeningRef = useRef(false);
  const manualStopRef = useRef(false);
  // Timestamp of the last stopListening() call. startListening() waits up to
  // 250 ms past this so Chrome has time to release the MediaStream / close
  // the AudioContext before we re-acquire the mic. Without this, a quick
  // user double-tap (turn ends, user clicks again ~50 ms later) raced into
  // an "AudioContext not available" error.
  const prevSessionEndedAtRef = useRef(0);
  const MIN_SESSION_GAP_MS = 250;
  // ElevenLabs cooldown: if the edge function 503s / 429s / network blips
  // twice in a row, skip it briefly then retry. Stored as state so
  // isStreamingTTSAvailable can be computed purely from props/state during
  // render (no Date.now() / ref read at render time). The cooldown
  // self-heals — a setTimeout flips it back enabled after ELEVEN_COOLDOWN_MS.
  //
  // Reduced from 60 s → 15 s on 2026-05-10 because the longer window made the
  // voice feel "stuck on Web Speech" any time the user accidentally
  // double-fired a turn (e.g. wake-greeting StrictMode remount in dev).
  // 15 s is enough to dodge sustained quota / outage but recovers fast on
  // transient blips.
  const [elevenAvailable, setElevenAvailable] = useState(true);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ELEVEN_COOLDOWN_MS = 5_000;
  // Single-flight guard. If two speak() calls fire in the same render cycle
  // (e.g. wake-greeting + initialGreeting both speaking on open), the second
  // one waits for the first instead of hitting ElevenLabs in parallel and
  // tripping their per-key concurrency limit. Tracks the in-flight promise.
  const inFlightSpeakRef = useRef<Promise<void> | null>(null);
  // What's currently playing (or just played within the dedup window). If a
  // speak() call comes in with the same text while the prior is still in
  // flight OR within DEDUP_WINDOW_MS of finishing, drop the duplicate. This
  // is what the user hears as the "voice repeats itself" — same text fires
  // from two effects that both think they own the greeting.
  const inFlightTextRef = useRef<string | null>(null);
  const lastSpokenAtRef = useRef<{ text: string; at: number } | null>(null);
  const DEDUP_WINDOW_MS = 2_000;

  // Manual mute. When true, `startListening` no-ops and `isMuted` is exposed
  // so the AssistantProvider's auto-resume gate can skip reopening the mic
  // after the AI finishes speaking. The mute persists across turns until the
  // user explicitly toggles it off. AI TTS still plays when muted — this
  // controls the user's input only, not the assistant's output.
  const [isMuted, setIsMuted] = useState(false);
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      // Stop any active recognition the moment we mute, so the user doesn't
      // see the orb in "listening" state for a beat after tapping mute.
      if (next) {
        manualStopRef.current = true;
        listeningRef.current = false;
        speech.stopRecognition();
        deepgram.stopRecognition();
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
      }
      return next;
    });
  }, [dispatch, speech, deepgram]);

  const startListening = useCallback(async (sttHints: string[] = []): Promise<{ transcript: string; alternatives: string[]; stopped: boolean }> => {
    if (listeningRef.current) return { transcript: "", alternatives: [], stopped: false };
    // Manual mute short-circuits: report `stopped: true` so callers don't
    // mistake this for an empty-transcript retry loop.
    if (isMuted) return { transcript: "", alternatives: [], stopped: true };
    // Wait for the prior session's teardown to finish if we're inside the
    // post-stop gap. Eliminates a Chrome race where re-acquiring the mic
    // before the previous stream was fully released errors out.
    const sinceLastStop = Date.now() - prevSessionEndedAtRef.current;
    if (prevSessionEndedAtRef.current > 0 && sinceLastStop < MIN_SESSION_GAP_MS) {
      await new Promise((r) => setTimeout(r, MIN_SESSION_GAP_MS - sinceLastStop));
    }
    listeningRef.current = true;
    manualStopRef.current = false;

    if (elevenlabs.isSpeaking) {
      elevenlabs.stop();
    } else if (speech.isSpeaking) {
      speech.stopSpeaking();
    }

    dispatch({ type: "SET_VOICE_STATUS", status: "listening" });

    try {
      let transcript = "";
      let alternatives: string[] = [];
      if (DEEPGRAM_ENABLED && deepgram.isSupported) {
        try {
          const result = await deepgram.startRecognition(sttHints);
          transcript = result.transcript;
          alternatives = result.alternatives;
        } catch (err) {
          // Never fall back to browser speech recognition. Deepgram failures
          // surface upward so the UI can fail closed instead of silently
          // switching to Google/Chrome transcription.
          const msg = (err as Error)?.message ?? "";
          if (msg === "not-allowed" || msg.includes("not-allowed")) throw err;
          throw new Error(`deepgram-stt-unavailable:${msg || "unknown"}`);
        }
      } else {
        throw new Error("voice-stt-unavailable");
      }

      if (!manualStopRef.current) {
        dispatch({ type: "SET_VOICE_STATUS", status: "processing" });
      }
      return { transcript, alternatives, stopped: manualStopRef.current };
    } catch (err) {
      if (!manualStopRef.current) {
        // Only show the red "Grant microphone access" state when the user has
        // actually denied permission. Transient errors (InvalidStateError,
        // recognition-start-failed, audio-capture races, etc.) fall back to idle
        // so the provider's retry path can silently try again.
        const msg = (err as Error)?.message ?? "";
        const isPermDenied = msg === "not-allowed" || msg.includes("not-allowed");
        dispatch({
          type: "SET_VOICE_STATUS",
          status: isPermDenied ? "error" : "idle",
        });
      }
      throw err;
    } finally {
      listeningRef.current = false;
      // Record the natural end-of-turn time too, so a fast user
      // double-click after the recognizer settled gets the same race-safety
      // gap as a manual stopListening().
      prevSessionEndedAtRef.current = Date.now();
    }
  }, [dispatch, speech, deepgram, elevenlabs, isMuted]);

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    listeningRef.current = false;
    prevSessionEndedAtRef.current = Date.now();
    // Always stop both backends — stopping an idle one is a no-op and this
    // avoids any race where we disabled the wrong recognizer.
    speech.stopRecognition();
    deepgram.stopRecognition();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, speech, deepgram]);

  const speak = useCallback(
    async (text: string) => {
      if (!text) return;
      if (
        import.meta.env.DEV &&
        (window as unknown as { __cenaivaSilenceTTS?: boolean }).__cenaivaSilenceTTS
      ) {
        return;
      }
      const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
      const normalized = normalize(text);
      // Dedup: drop a duplicate of the in-flight text outright.
      if (inFlightTextRef.current && normalize(inFlightTextRef.current) === normalized) {
        if (import.meta.env.DEV) console.log(`[Cenaiva TTS] dropped duplicate (in-flight): "${text.slice(0, 60)}…"`);
        return;
      }
      // Dedup: drop a duplicate of the last-spoken text within the recent
      // window (covers StrictMode double-mounts where the second call lands
      // just after the first finishes).
      const last = lastSpokenAtRef.current;
      if (last && normalize(last.text) === normalized && (Date.now() - last.at) < DEDUP_WINDOW_MS) {
        if (import.meta.env.DEV) console.log(`[Cenaiva TTS] dropped duplicate (recent): "${text.slice(0, 60)}…"`);
        return;
      }
      // Single-flight: wait for any in-flight speak() to finish before
      // starting a new one. Prevents ElevenLabs concurrent-call 429s when
      // two distinct turns try to speak in parallel.
      if (inFlightSpeakRef.current) {
        try { await inFlightSpeakRef.current; } catch { /* prior call's error */ }
      }
      // Recheck the dedup window after waiting — the in-flight call we just
      // awaited may have spoken THIS text, in which case skip.
      const last2 = lastSpokenAtRef.current;
      if (last2 && normalize(last2.text) === normalized && (Date.now() - last2.at) < DEDUP_WINDOW_MS) {
        if (import.meta.env.DEV) console.log(`[Cenaiva TTS] dropped duplicate (post-await): "${text.slice(0, 60)}…"`);
        return;
      }
      inFlightTextRef.current = text;
      const speakPromise = (async () => {
        dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });

        let played = false;
        if (elEnabledFlag && elevenAvailable) {
          if (import.meta.env.DEV) console.log(`[Cenaiva TTS] attempting ElevenLabs: "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`);
          try {
            played = await elevenlabs.speak(text);
          } catch {
            played = false;
          }
          // Retry ElevenLabs once on transient failure before falling back to
          // Web Speech — keeps the voice consistent across turns instead of
          // randomly swapping to the OS voice when a single request blips.
          if (!played) {
            try {
              played = await elevenlabs.speak(text);
            } catch {
              played = false;
            }
          }
          // Two failures in a row → cooldown ElevenLabs for ELEVEN_COOLDOWN_MS
          // (15 s as of 2026-05-10) and route this turn through Web Speech.
          // The cooldown self-heals.
          if (!played) {
            console.warn(
              `[Cenaiva TTS] ElevenLabs failed twice — falling back to Web Speech for ${ELEVEN_COOLDOWN_MS / 1000}s`,
            );
            setElevenAvailable(false);
            if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
            cooldownTimerRef.current = setTimeout(() => {
              setElevenAvailable(true);
              cooldownTimerRef.current = null;
            }, ELEVEN_COOLDOWN_MS);
          }
        }
        if (!played) {
          if (import.meta.env.DEV) console.log(`[Cenaiva TTS] using Web Speech fallback (browser voice): "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`);
          await speech.speak(text);
        } else if (import.meta.env.DEV) {
          console.log(`[Cenaiva TTS] played via ElevenLabs ✓`);
        }

        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
      })();
      inFlightSpeakRef.current = speakPromise;
      try {
        await speakPromise;
        lastSpokenAtRef.current = { text, at: Date.now() };
      } finally {
        if (inFlightSpeakRef.current === speakPromise) {
          inFlightSpeakRef.current = null;
        }
        if (inFlightTextRef.current === text) {
          inFlightTextRef.current = null;
        }
      }
    },
    [dispatch, elevenlabs, speech, elEnabledFlag, elevenAvailable],
  );

  const stopSpeaking = useCallback(() => {
    elevenlabs.stop();
    speech.stopSpeaking();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, elevenlabs, speech]);

  // ── Streaming TTS (phone-call pacing) ─────────────────────────────────────
  // Available only when ElevenLabs is enabled. Web Speech doesn't have a
  // safe queued-streaming primitive that works consistently across browsers,
  // so the fallback path skips streaming and the caller speaks the full
  // final text in one shot. Mirrors the cooldown gating in speak() so that
  // streaming chunks resume automatically after the 60s window passes.
  const isStreamingTTSAvailable = elEnabledFlag && elevenAvailable;

  const speakStreamingChunk = useCallback(
    (text: string) => {
      if (!isStreamingTTSAvailable) return;
      dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });
      elevenlabs.speakQueued(text);
    },
    [dispatch, elevenlabs, isStreamingTTSAvailable],
  );

  const discardStreamingSpeech = useCallback(() => {
    elevenlabs.discardQueued();
  }, [elevenlabs]);

  const drainStreamingSpeech = useCallback(async () => {
    await elevenlabs.drainQueue();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [elevenlabs, dispatch]);

  // primeTTS bundles both halves of "first-utterance latency": Safari/Chrome
  // audio-context unlock (speech.primeTTS, fast, sync) + IDB common-phrase
  // cache warm-up (elevenlabs.primeCache, async, fire-and-forget).
  const primeTTS = useCallback(() => {
    speech.primeTTS();
    void elevenlabs.primeCache();
  }, [speech, elevenlabs]);

  return {
    startListening,
    stopListening,
    speak,
    speakStreamingChunk,
    discardStreamingSpeech,
    drainStreamingSpeech,
    isStreamingTTSAvailable,
    stopSpeaking,
    primeTTS,
    isMuted,
    toggleMute,
    voiceStatus: state.voiceStatus,
    isRecognitionSupported: DEEPGRAM_ENABLED && deepgram.isSupported,
    isSpeaking: elevenlabs.isSpeaking || speech.isSpeaking,
    isRecording: speech.isRecording || deepgram.isRecording,
    // Audio-level external store for the orb pulse. Consumers should call
    // `useSyncExternalStore(voice.subscribeAudioLevel, voice.getAudioLevel)`
    // — direct render-time reads bypass the no-rerender contract.
    subscribeAudioLevel: deepgram.subscribeAudioLevel,
    getAudioLevel: deepgram.getAudioLevel,
  };
}

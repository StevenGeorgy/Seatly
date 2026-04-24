import { useCallback, useRef, useState } from "react";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

/**
 * Replace "Cenaiva" in spoken text with a phonetic spelling that Web Speech
 * Synthesis voices render as "sin-eye-vuh" rather than the default "sen-ay-vuh".
 * Applied only to TTS utterances — not to any text displayed in the UI.
 */
function applyPronunciation(text: string): string {
  return text.replace(/\bCenaiva\b/gi, "sin eye vuh");
}

// How long (ms) to wait after the last final speech result before resolving.
// Gives the user time to pause mid-sentence without being cut off.
const SILENCE_TIMEOUT_MS = 1500;
// How long (ms) to wait after the last INTERIM result with no further activity
// before we force recognition to stop. Chrome sometimes never promotes an
// interim to a final result (quiet speech, background noise, slow network
// round-trip to Google) — without this watchdog the mic stays pinned on
// "Listening…" forever and the promise never resolves.
const INTERIM_SILENCE_TIMEOUT_MS = 2500;
// Hard cap: even if no speech activity is detected at all, stop recognition
// after this long so the caller can relisten / go idle instead of hanging.
const MAX_LISTEN_DURATION_MS = 15000;

/**
 * Chrome loads voices asynchronously. The first speechSynthesis.speak() call
 * silently fails if getVoices() is still empty. This helper waits up to 2 s
 * for the voices list to populate before proceeding.
 */
function waitForVoices(): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) { resolve(); return; }
    if (window.speechSynthesis.getVoices().length > 0) { resolve(); return; }
    const handler = () => { resolve(); window.speechSynthesis.removeEventListener("voiceschanged", handler); };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Fallback: resolve anyway after 2 s even if the event never fires
    setTimeout(resolve, 2000);
  });
}

export function useCenaivaSpeech(lang: string = "en-CA") {
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recognitionRef = useRef<any>(null);

  const isRecognitionSupported = !!SpeechRecognitionAPI;
  const isSynthesisSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  const startRecognition = useCallback((): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!SpeechRecognitionAPI) {
        reject(new Error("Speech recognition not supported"));
        return;
      }

      // Defensive: tear down any lingering recognition before starting a new one.
      // Chrome throws InvalidStateError if start() is called with a stale instance.
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }

      let settled = false;
      let accumulatedTranscript = "";
      let latestInterim = "";
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;
      let interimSilenceTimer: ReturnType<typeof setTimeout> | null = null;

      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      recognition.lang = lang;
      // continuous: true stops Chrome from auto-ending on a mid-sentence pause.
      // We manually stop after SILENCE_TIMEOUT_MS of no new final results.
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // Hard max watchdog — guarantees the promise resolves even if Chrome
      // never emits any result at all (muted mic, blocked audio graph, etc.).
      const maxDurationTimer = setTimeout(() => {
        try { recognition.stop(); } catch { /* ignore */ }
      }, MAX_LISTEN_DURATION_MS);

      const clearTimers = () => {
        if (silenceTimer) clearTimeout(silenceTimer);
        if (interimSilenceTimer) clearTimeout(interimSilenceTimer);
        clearTimeout(maxDurationTimer);
      };

      const finish = (transcript: string) => {
        if (!settled) {
          settled = true;
          clearTimers();
          recognitionRef.current = null;
          setIsRecording(false);
          resolve(transcript.trim());
        }
      };

      recognition.onresult = (event: any) => {
        // Reset both silence timers on any activity
        if (silenceTimer) clearTimeout(silenceTimer);
        if (interimSilenceTimer) clearTimeout(interimSilenceTimer);

        let finalChunk = "";
        let interimChunk = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          const text = res[0]?.transcript || "";
          if (res.isFinal) finalChunk += text;
          else interimChunk += text;
        }

        if (finalChunk) {
          accumulatedTranscript +=
            (accumulatedTranscript ? " " : "") + finalChunk;
          // Start (or restart) the post-final silence timer
          silenceTimer = setTimeout(() => {
            try { recognition.stop(); } catch { /* ignore */ }
          }, SILENCE_TIMEOUT_MS);
        } else if (interimChunk) {
          // Track the most recent interim so onend can fall back to it if
          // Chrome never promotes it to a final. Without this, users whose
          // speech stays "interim only" (Chrome bug under certain network
          // conditions) get a blank transcript even though they spoke.
          latestInterim = interimChunk.trim();
          interimSilenceTimer = setTimeout(() => {
            try { recognition.stop(); } catch { /* ignore */ }
          }, INTERIM_SILENCE_TIMEOUT_MS);
        }
      };

      recognition.onerror = (event: any) => {
        // Treat transient / retriable errors as safe completions so the caller
        // can silently re-try rather than showing the red-mic error state.
        // "not-allowed" is the only fatal one (user denied permission).
        const transient = ["no-speech", "aborted", "audio-capture", "service-not-allowed"];
        if (transient.includes(event.error)) {
          finish(accumulatedTranscript || latestInterim);
        } else if (!settled) {
          settled = true;
          clearTimers();
          setIsRecording(false);
          reject(new Error(event.error));
        }
      };

      // onend fires when recognition.stop() is called (from silence timer or
      // externally via stopRecognition) or when Chrome auto-ends.
      recognition.onend = () => {
        finish(accumulatedTranscript || latestInterim);
      };

      setIsRecording(true);
      try {
        recognition.start();
      } catch (e) {
        setIsRecording(false);
        recognitionRef.current = null;
        reject(new Error("recognition-start-failed:" + ((e as Error)?.message ?? "")));
      }
    });
  }, [lang]);

  const stopRecognition = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  }, []);

  /**
   * Prime Web Speech synthesis inside a user-gesture callback so Chrome
   * unlocks audio output before the first real TTS utterance is queued.
   * Call this from any onClick handler that will later trigger speak().
   */
  const primeTTS = useCallback(() => {
    if (!isSynthesisSupported) return;
    // Cancel any stale pending utterances so the warmer isn't queued behind
    // something that's stuck — Chrome sometimes reports pending=true for a
    // dead utterance across tab focus changes.
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    window.speechSynthesis.resume();
    // Queue a SINGLE-SPACE (not empty) utterance. Chrome treats empty-string
    // utterances as no-ops and never fires onstart, so the autoplay unlock
    // doesn't actually get granted. A space is inaudible but still triggers
    // the speech pipeline's unlock sequence.
    const warm = new SpeechSynthesisUtterance(" ");
    warm.volume = 0;
    window.speechSynthesis.speak(warm);
  }, [isSynthesisSupported]);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!isSynthesisSupported) return;

      // Wait for Chrome to populate the voices list before queuing an utterance.
      // getVoices() returns [] on the first call; speaking into an empty list
      // silently swallows the audio.
      await waitForVoices();

      // Chrome bug: speechSynthesis can freeze in a "paused" state after ~15s
      // of inactivity — the next speak() queues an utterance that never fires
      // onstart. Cancel any pending + resume kicks the engine back to life.
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      try { window.speechSynthesis.resume(); } catch { /* ignore */ }

      // Pick the best available English voice. Without this Chrome will pick
      // a default that occasionally is set to a non-audible voice in some
      // OS/profile combinations, causing silent TTS.
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice =
        voices.find((v) => v.lang?.toLowerCase().startsWith(lang.toLowerCase())) ||
        voices.find((v) => v.lang?.toLowerCase().startsWith("en")) ||
        voices[0];

      const phoneticText = applyPronunciation(text);
      const wordCount = text.split(/\s+/).length;
      const estimatedDurationMs = wordCount * 65 + 3000;

      const speakOnce = (): Promise<"ok" | "silent" | "error"> =>
        new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(phoneticText);
          utterance.lang = lang;
          utterance.rate = 1;
          utterance.pitch = 1;
          if (preferredVoice) utterance.voice = preferredVoice;

          let settled = false;
          let started = false;

          const finalTimeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            setIsSpeaking(false);
            resolve(started ? "ok" : "silent");
          }, estimatedDurationMs);

          utterance.onstart = () => {
            started = true;
            setIsSpeaking(true);
          };
          utterance.onend = () => {
            if (settled) return;
            settled = true;
            clearTimeout(finalTimeout);
            setIsSpeaking(false);
            resolve("ok");
          };
          utterance.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(finalTimeout);
            setIsSpeaking(false);
            resolve(started ? "ok" : "error");
          };

          // Start watchdog: if neither onstart nor speaking state flips true
          // within 400 ms, Chrome swallowed the utterance — resolve "silent"
          // so the caller can retry.
          setTimeout(() => {
            if (settled || started) return;
            if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
              settled = true;
              clearTimeout(finalTimeout);
              setIsSpeaking(false);
              resolve("silent");
            }
          }, 400);

          window.speechSynthesis.speak(utterance);
        });

      let result = await speakOnce();
      if (result === "silent" || result === "error") {
        // One retry with a fresh engine state. Chrome often recovers on the
        // second attempt after we cancel+resume a second time.
        try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
        try { window.speechSynthesis.resume(); } catch { /* ignore */ }
        await new Promise((r) => setTimeout(r, 80));
        result = await speakOnce();
      }
    },
    [lang, isSynthesisSupported],
  );

  const stopSpeaking = useCallback(() => {
    if (isSynthesisSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, [isSynthesisSupported]);

  return {
    isRecording,
    isSpeaking,
    isRecognitionSupported,
    isSynthesisSupported,
    startRecognition,
    stopRecognition,
    speak,
    stopSpeaking,
    primeTTS,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// Phonetic variants of "Cenaiva" (pronounced "sin-eye-vuh") that speech
// recognition engines may return. Add new entries here if you see something
// unexpected in the console log "[CenaivaWakeWord] heard: …".
const WAKE_PHRASES = [
  // Direct spellings
  "cenaiva", "senaiva", "seneva", "ceneva", "soneva", "caniva", "ceniva", "cenefa",
  // Phonetic: "sin-eye-vuh" broken up
  "sin iva", "sin eva", "sine iva", "sine eva",
  "sin eye va", "sine eye va", "sin i va",
  "sinai va", "sinai vuh",
  "seen a va", "seen eva", "see neva", "seena va",
  // As one word
  "siniva", "sineva", "sinaiva", "syneva", "syniva",
  // Partial root matches (long enough to avoid accidental hits)
  "senai", "cenai", "sinai",
  // Explicit "hey <name>" forms
  "hey cenaiva", "hey senaiva", "hey seneva", "hey ceneva", "hey ceniva",
  "hey sinai", "hey sin eye", "hey sine eye", "hey sinaiva", "hey siniva",
  "hey sin eva", "hey sin iva", "hey seen a va",
  // ── Observed Chrome transcripts (from live console logs) ──
  // Session 1: "hey saniva", "hey sonaiva", "hey synova", "case naiva", "hasten ivor"
  "saniva", "sonaiva", "naiva", "synova",
  "son iva", "son eva", "son either", "son over",
  "hey saniva", "hey sonaiva", "hey synova",
  "hey son iva", "hey son eva", "hey son either", "hey son over",
  "case naiva", "hasten ivor", "hasten iv",
  // Session 2: "hastenova", "hey geneva", "hey chennai*", "hey canova", "hey sana/sene"
  "hastenova", "hasten over",
  "hey geneva", "geneva",
  "hey chennai", "hey chennaiwa", "hey cheniva", "chennaiwa", "cheniva",
  "hey canova", "canova",
  "hey sana", "hey sene",
  "hey seneva",
];

function isWakePhrase(transcript: string): boolean {
  return WAKE_PHRASES.some((phrase) => transcript.includes(phrase));
}

// Guard rails for the Chrome SpeechRecognition restart loop.
// Without these, a tight retry loop leaks mic buffers and burns RAM.
const RESTART_BASE_MS = 400;       // first retry delay
const RESTART_MAX_MS = 10_000;     // cap on exponential backoff
const MAX_CONSECUTIVE_ERRORS = 4;  // stop after 4 errors in a row, wait for user action

export function useCenaivaWakeWord(onWake: () => void, lang: string = "en-CA") {
  const [enabled, setEnabled] = useState(false);
  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(false);
  // Store the latest onWake in a ref so startListening doesn't depend on it.
  // This prevents the useEffect from tearing down / recreating the recognizer
  // on every provider render (the #1 cause of the wake word appearing "dead").
  const onWakeRef = useRef(onWake);
  const restartTimerRef = useRef<number | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const restartDelayRef = useRef(RESTART_BASE_MS);

  const isSupported = !!SpeechRecognitionAPI;

  // Keep onWakeRef pointing at the freshest callback without affecting deps
  useEffect(() => {
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Synchronously stop the recognizer and clear the ref.
  // Used by CenaivaProvider to free the mic before starting the command
  // recognizer — avoids the Chrome "one active recognizer" race condition.
  const forceStop = useCallback(() => {
    // Update both the ref AND the state so setEnabled(true) later will
    // actually trigger the useEffect and restart the recognizer.
    enabledRef.current = false;
    setEnabled(false);
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    consecutiveErrorsRef.current = 0;
    restartDelayRef.current = RESTART_BASE_MS;
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (rec) {
      try { rec.stop(); } catch {}
    }
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI || !enabledRef.current) return;

    // Guard against double-start: stop any existing instance first
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }

    try {
      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      recognition.lang = lang;
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript.toLowerCase().trim();
          if (isWakePhrase(transcript)) {
            // Disable BEFORE calling onWake so the onend handler won't
            // schedule an auto-restart and race the command recognizer.
            enabledRef.current = false;
            consecutiveErrorsRef.current = 0;
            restartDelayRef.current = RESTART_BASE_MS;
            try { recognition.stop(); } catch {}
            onWakeRef.current();
            return;
          }
        }
        // Any audio activity resets the error backoff — we're healthy.
        if (consecutiveErrorsRef.current > 0) {
          consecutiveErrorsRef.current = 0;
          restartDelayRef.current = RESTART_BASE_MS;
        }
      };

      recognition.onend = () => {
        if (!enabledRef.current) return;
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
          // Too many failures in a row — stop the loop entirely. User can
          // re-enable via the toggle; avoids a runaway mic-stream leak.
          enabledRef.current = false;
          setEnabled(false);
          return;
        }
        if (restartTimerRef.current !== null) {
          window.clearTimeout(restartTimerRef.current);
        }
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null;
          startListening();
        }, restartDelayRef.current);
      };

      recognition.onerror = (event: any) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          enabledRef.current = false;
          setEnabled(false);
          return;
        }
        if (event.error === "no-speech" || event.error === "aborted") return;
        // Real error — bump the backoff. onend will schedule the delayed restart.
        consecutiveErrorsRef.current += 1;
        restartDelayRef.current = Math.min(
          restartDelayRef.current * 2,
          RESTART_MAX_MS,
        );
      };

      try {
        recognition.start();
      } catch {
        // start() can throw InvalidStateError if another recognizer holds the mic.
        // Count it as an error so backoff kicks in.
        consecutiveErrorsRef.current += 1;
        restartDelayRef.current = Math.min(
          restartDelayRef.current * 2,
          RESTART_MAX_MS,
        );
      }
    } catch {
      // Constructor threw — nothing to clean up; retry on next enable toggle.
    }
  }, [lang]); // onWake intentionally omitted — accessed via onWakeRef

  useEffect(() => {
    if (enabled) {
      consecutiveErrorsRef.current = 0;
      restartDelayRef.current = RESTART_BASE_MS;
      startListening();
    } else {
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
    }

    return () => {
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
    };
  }, [enabled, startListening]);

  const toggle = useCallback(() => {
    setEnabled((prev) => !prev);
  }, []);

  return {
    enabled,
    isSupported,
    toggle,
    setEnabled,
    forceStop,
  };
}

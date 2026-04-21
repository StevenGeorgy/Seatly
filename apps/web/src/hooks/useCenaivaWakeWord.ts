import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// Phonetic variants of "Cenaiva" (pronounced "sin-eye-vuh") that speech
// recognition engines may return when the user says "hey Cenaiva". Every
// entry MUST start with "hey " — bare forms like "cenaiva" no longer wake
// the assistant (avoids spurious wakes when the name is mentioned in passing).
const WAKE_PHRASES = [
  // Direct spellings after "hey"
  "hey cenaiva", "hey senaiva", "hey seneva", "hey ceneva", "hey ceniva",
  "hey soneva", "hey caniva", "hey cenefa",
  // Phonetic "sin-eye-vuh" breakdowns
  "hey sin iva", "hey sin eva", "hey sine iva", "hey sine eva",
  "hey sin eye va", "hey sine eye va", "hey sin i va",
  "hey sinai va", "hey sinai vuh", "hey sinai", "hey sinaiva", "hey siniva",
  "hey sin eye", "hey sine eye",
  // Observed Chrome transcripts from live console logs
  "hey saniva", "hey sonaiva", "hey synova",
  "hey son iva", "hey son eva", "hey son either", "hey son over",
  "hey geneva", "hey chennai", "hey chennaiwa", "hey cheniva",
  "hey canova", "hey sana", "hey sene",
  "hey seen a va", "hey see neva", "hey seena va", "hey seen eva",
  // Chrome often SLURS "hey cenaiva" into a single word — these ARE
  // valid wakes even though "hey" isn't a separate token.
  "hasanova", "hasanov", "hastenova", "hasen over", "hason over",
  "hasen ova", "hason ova", "hason", "hasen", "hasenov",
  "hasanova", "hasanovo", "hasanave", "hasenova",
  "hastenov", "hasten over", "hasten ova", "hasten iv", "hasten ivor",
  "a son over", "a sin over", "a son ova", "a sen ova",
  "payson over", "payson ova", "payson",
];

// Loose phonetic catch-alls:
//  1. "hey <word>" where the word sounds like "cenaiva".
//  2. Slurred single-token forms like "hasanova" / "hastenova" that Chrome
//     emits when "hey cenaiva" is said quickly as one breath.
const WAKE_HEY_REGEX =
  /\bhey[\s,\.!\?\-]+[csk][a-z]*[aeiouy][a-z]*[vfwb][a-z]*\b/i;
const WAKE_SLURRED_REGEX =
  /\bh[ae]s(?:[aeiou]n|ten|in)[a-z]*(?:ov|iv|av|ef|eff)[a-z]*\b/i;

function isWakePhrase(transcript: string): boolean {
  const cleaned = transcript.toLowerCase().replace(/[.,!?]/g, "");
  if (WAKE_PHRASES.some((phrase) => cleaned.includes(phrase))) return true;
  if (WAKE_HEY_REGEX.test(cleaned)) return true;
  if (WAKE_SLURRED_REGEX.test(cleaned)) return true;
  return false;
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
          if (import.meta.env.DEV) {
            console.log("[WakeWord] heard:", transcript);
          }
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

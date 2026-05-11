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
  "hey cenaiva", "hey senaiva", "hey seneva", "hey ceneva", "hey ceniva",
  "hey soneva", "hey caniva", "hey cenefa",
  "hey genevia", "hey geniva", "hey jean iva", "hey jean i",
  "hey sin iva", "hey sin eva", "hey sine iva", "hey sine eva",
  "hey sin eye va", "hey sine eye va", "hey sin i va",
  "hey sinai va", "hey sinai vuh", "hey sinai", "hey sinaiva", "hey siniva",
  "hey sinaiv", "hey sinivia", "hey sineva", "hey cinema",
  "hey sin eye", "hey sine eye",
  "hey saniva", "hey sanivia", "hey sanaiva", "hey sonaiva", "hey soniva",
  "hey synova", "hey survivor", "hey server", "hey sniver",
  "hey son iva", "hey son eva", "hey son either", "hey son over",
  "hey son ever", "hey son iver", "hey son ivor", "hey son abba",
  "hey geneva", "hey chennai", "hey chennaiwa", "hey chennaira",
  "hey cheniva", "hey chi neva", "hey cheneva", "hey china iva",
  "hey canova", "hey can iva", "hey canivir", "hey canniva",
  "hey coniva", "hey cannibal", "hey canadian", "hey canadia",
  "hey sana", "hey sanaa", "hey sene", "hey senev", "hey senevia",
  "hey senate iva", "hey senator iva", "hey senna iva",
  "hey kina iva", "hey kina either", "hey kenna iva",
  "hey cindy iva", "hey simi iva", "hey semi iva", "hey semi-aver",
  "hey semi-evil", "hey semi neither", "hey send me iva",
  "hey cleavinia", "hey clavinia", "hey lenova", "hey leniva",
  "hey sandva", "hey snava", "hey sanava",
  "hey seen a va", "hey see neva", "hey seena va", "hey seen eva",
  "h and iva", "h and iver", "h niver", "hsniver",
  "haitianivia", "haitian iva", "haitian either", "haitian ever",
  "hasanova", "hasanov", "hastenova", "hasen over", "hason over",
  "hasen ova", "hason ova", "hason", "hasen", "hasenov",
  "hasanova", "hasanovo", "hasanave", "hasenova",
  "hastenov", "hasten over", "hasten ova", "hasten iv", "hasten ivor",
  "hasting nova", "hasting no", "hasting nov",
  "he's another", "here's another", "here's an over", "there's another",
  "there is another", "has another", "had another",
  "jason over", "basin over", "ocean over", "asian over", "person over",
  "a son over", "a sin over", "a son ova", "a sen ova",
  "payson over", "payson ova", "payson",
];

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

const RESTART_BASE_MS = 400;
const RESTART_MAX_MS = 10_000;
const MAX_CONSECUTIVE_ERRORS = 4;

export function useCenaivaWakeWord(onWake: () => void, lang: string = "en-CA") {
  const [enabled, setEnabled] = useState(false);
  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(false);
  const onWakeRef = useRef(onWake);
  const restartTimerRef = useRef<number | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const restartDelayRef = useRef(RESTART_BASE_MS);

  const isSupported = !!SpeechRecognitionAPI;

  useEffect(() => {
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const forceStop = useCallback(() => {
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
      try { rec.stop(); } catch { /* ignore */ }
    }
  }, []);

  const startListening = useCallback(() => {
    if (!SpeechRecognitionAPI || !enabledRef.current) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
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
          const matched = isWakePhrase(transcript);
          if (import.meta.env.DEV) {
            console.log(`[WakeWord] heard: "${transcript}" — match=${matched} enabled=${enabledRef.current}`);
          }
          if (matched) {
            if (import.meta.env.DEV) console.log("[WakeWord] 🚀 firing onWake");
            enabledRef.current = false;
            consecutiveErrorsRef.current = 0;
            restartDelayRef.current = RESTART_BASE_MS;
            try { recognition.stop(); } catch { /* ignore */ }
            onWakeRef.current();
            return;
          }
        }
        if (consecutiveErrorsRef.current > 0) {
          consecutiveErrorsRef.current = 0;
          restartDelayRef.current = RESTART_BASE_MS;
        }
      };

      recognition.onend = () => {
        if (!enabledRef.current) return;
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) {
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
        consecutiveErrorsRef.current += 1;
        restartDelayRef.current = Math.min(
          restartDelayRef.current * 2,
          RESTART_MAX_MS,
        );
      };

      try {
        recognition.start();
      } catch {
        consecutiveErrorsRef.current += 1;
        restartDelayRef.current = Math.min(
          restartDelayRef.current * 2,
          RESTART_MAX_MS,
        );
      }
    } catch {
      // Constructor threw — retry on next enable toggle.
    }
  }, [lang]);

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
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
      recognitionRef.current = null;
    }

    return () => {
      if (restartTimerRef.current !== null) {
        window.clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      try { recognitionRef.current?.stop(); } catch { /* ignore */ }
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

import { useCallback, useEffect, useRef, useState } from "react";

const SpeechRecognitionAPI =
  typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// Phonetic variants of "Cenaiva" (pronounced "sin-eye-vuh") that speech
// recognition engines may return. Deliberately excludes broad prefixes
// like "hey c" / "hey s" which caused false positives on any "hey c…" sentence.
const WAKE_PHRASES = [
  // Direct spellings
  "cenaiva", "senaiva", "seneva", "ceneva", "soneva", "caniva",
  // Phonetic: "sin-eye-vuh" broken up
  "sin iva", "sin eva", "sine iva", "sine eva",
  "sin eye va", "sine eye va", "sin i va",
  "sinai va", "sinai vuh",
  // As one word
  "siniva", "sineva", "sinaiva", "syneva", "syniva",
  // Partial root matches
  "senai", "cenai", "sinai",
  // Explicit "hey <name>" forms
  "hey cenaiva", "hey senaiva", "hey seneva", "hey ceneva",
  "hey sinai", "hey sin eye", "hey sine eye", "hey sinaiva", "hey siniva",
];

function isWakePhrase(transcript: string): boolean {
  return WAKE_PHRASES.some((phrase) => transcript.includes(phrase));
}

export function useCenaivaWakeWord(onWake: () => void, lang: string = "en-CA") {
  const [enabled, setEnabled] = useState(false);
  const recognitionRef = useRef<any>(null);
  const enabledRef = useRef(false);
  // Store the latest onWake in a ref so startListening doesn't depend on it.
  // This prevents the useEffect from tearing down / recreating the recognizer
  // on every provider render (the #1 cause of the wake word appearing "dead").
  const onWakeRef = useRef(onWake);

  const isSupported = !!SpeechRecognitionAPI;

  // Keep onWakeRef pointing at the freshest callback without affecting deps
  useEffect(() => {
    onWakeRef.current = onWake;
  });

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

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
            // schedule a 300ms auto-restart and race the command recognizer.
            enabledRef.current = false;
            recognition.stop();
            onWakeRef.current();
            return;
          }
        }
      };

      recognition.onend = () => {
        // Auto-restart only if still enabled (wake-triggered stops have
        // already set enabledRef.current = false above).
        if (enabledRef.current) {
          setTimeout(() => startListening(), 300);
        }
      };

      recognition.onerror = (event: any) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          console.warn("[CenaivaWakeWord] Microphone permission denied:", event.error);
          setEnabled(false);
        } else {
          // no-speech / network / aborted — onend will handle the restart
          console.warn("[CenaivaWakeWord] Recognition error:", event.error);
        }
      };

      recognition.start();
    } catch (err) {
      console.warn("[CenaivaWakeWord] Failed to start recognition:", err);
    }
  }, [lang]); // onWake intentionally omitted — accessed via onWakeRef

  useEffect(() => {
    if (enabled) {
      startListening();
    } else {
      try { recognitionRef.current?.stop(); } catch {}
      recognitionRef.current = null;
    }

    return () => {
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
  };
}

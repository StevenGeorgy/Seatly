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

  // Synchronously stop the recognizer and clear the ref.
  // Used by CenaivaProvider to free the mic before starting the command
  // recognizer — avoids the Chrome "one active recognizer" race condition.
  const forceStop = useCallback(() => {
    enabledRef.current = false;
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
          // Log every transcript so you can see what Chrome is hearing
          // and add new phrases to WAKE_PHRASES if needed.
          console.log("[CenaivaWakeWord] heard:", transcript);
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
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          // no-speech / aborted are normal; onend handles the restart
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
    forceStop,
  };
}

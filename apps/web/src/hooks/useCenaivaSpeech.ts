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
  // "Sinaiva" maps to the Mount Sinai phoneme cluster, which most English
  // voices pronounce as "sin-eye-vuh" — the correct Cenaiva pronunciation.
  return text.replace(/\bCenaiva\b/gi, "sin eye vuh");
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

      // Guard: only the first of onresult / onerror / onend resolves the promise
      let settled = false;

      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      recognition.lang = lang;
      // interimResults: true gives Chrome more signal to return a partial
      // transcript even when the user pauses slightly before finishing.
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.continuous = false;

      recognition.onresult = (event: any) => {
        // Look for the first final result in this event batch
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const transcript = event.results[i][0]?.transcript || "";
            if (!settled) {
              settled = true;
              setIsRecording(false);
              resolve(transcript);
            }
            return;
          }
        }
      };

      recognition.onerror = (event: any) => {
        if (!settled) {
          settled = true;
          setIsRecording(false);
          if (event.error === "no-speech") {
            resolve("");
          } else {
            reject(new Error(event.error));
          }
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
        // Safety resolve if onresult / onerror didn't fire (e.g. silent timeout)
        if (!settled) {
          settled = true;
          resolve("");
        }
      };

      setIsRecording(true);
      recognition.start();
    });
  }, [lang]);

  const stopRecognition = useCallback(() => {
    recognitionRef.current?.stop();
    setIsRecording(false);
  }, []);

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!isSynthesisSupported) {
        resolve();
        return;
      }

      // Cancel any current speech
      window.speechSynthesis.cancel();

      // Apply phonetic substitutions so "Cenaiva" is voiced as "sin-eye-vuh"
      const utterance = new SpeechSynthesisUtterance(applyPronunciation(text));
      utterance.lang = lang;
      utterance.rate = 1;
      utterance.pitch = 1;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });
  }, [lang, isSynthesisSupported]);

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
  };
}

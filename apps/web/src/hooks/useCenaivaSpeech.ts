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

      let settled = false;
      let accumulatedTranscript = "";
      let silenceTimer: ReturnType<typeof setTimeout> | null = null;

      const recognition = new SpeechRecognitionAPI();
      recognitionRef.current = recognition;
      recognition.lang = lang;
      // continuous: true stops Chrome from auto-ending on a mid-sentence pause.
      // We manually stop after SILENCE_TIMEOUT_MS of no new final results.
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      const finish = (transcript: string) => {
        if (!settled) {
          settled = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          recognitionRef.current = null;
          setIsRecording(false);
          resolve(transcript.trim());
        }
      };

      recognition.onresult = (event: any) => {
        // Reset the silence timer whenever any speech activity arrives
        if (silenceTimer) clearTimeout(silenceTimer);

        let finalChunk = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalChunk += event.results[i][0]?.transcript || "";
          }
        }

        if (finalChunk) {
          accumulatedTranscript +=
            (accumulatedTranscript ? " " : "") + finalChunk;
          // Start (or restart) the silence timer
          silenceTimer = setTimeout(() => {
            recognition.stop();
          }, SILENCE_TIMEOUT_MS);
        }
      };

      recognition.onerror = (event: any) => {
        // Treat transient / retriable errors as safe completions so the caller
        // can silently re-try rather than showing the red-mic error state.
        // "not-allowed" is the only fatal one (user denied permission).
        const transient = ["no-speech", "aborted", "audio-capture", "service-not-allowed"];
        if (transient.includes(event.error)) {
          finish(accumulatedTranscript);
        } else if (!settled) {
          settled = true;
          if (silenceTimer) clearTimeout(silenceTimer);
          setIsRecording(false);
          reject(new Error(event.error));
        }
      };

      // onend fires when recognition.stop() is called (from silence timer or
      // externally via stopRecognition) or when Chrome auto-ends.
      recognition.onend = () => {
        finish(accumulatedTranscript);
      };

      setIsRecording(true);
      recognition.start();
    });
  }, [lang]);

  const stopRecognition = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsRecording(false);
  }, []);

  const speak = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        if (!isSynthesisSupported) {
          resolve();
          return;
        }

        // Chrome bug: speechSynthesis can freeze in a "paused" state after a
        // period of inactivity. resume() then cancel() kick it back to life.
        window.speechSynthesis.resume();
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(applyPronunciation(text));
        utterance.lang = lang;
        utterance.rate = 1;
        utterance.pitch = 1;

        // Timeout fallback: Chrome sometimes silently fails to fire onend.
        // Estimate duration as ~65 ms/word + a 3 s buffer.
        const wordCount = text.split(/\s+/).length;
        let resolvedFlag = false;
        const timeoutId = setTimeout(() => {
          if (!resolvedFlag) {
            resolvedFlag = true;
            setIsSpeaking(false);
            resolve();
          }
        }, wordCount * 65 + 3000);

        utterance.onstart = () => setIsSpeaking(true);

        utterance.onend = () => {
          if (!resolvedFlag) {
            resolvedFlag = true;
            clearTimeout(timeoutId);
            setIsSpeaking(false);
            resolve();
          }
        };

        utterance.onerror = () => {
          if (!resolvedFlag) {
            resolvedFlag = true;
            clearTimeout(timeoutId);
            setIsSpeaking(false);
            resolve();
          }
        };

        window.speechSynthesis.speak(utterance);
      });
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
  };
}

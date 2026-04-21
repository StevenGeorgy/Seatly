import { useCallback, useRef } from "react";
import { useCenaivaSpeech } from "@/hooks/useCenaivaSpeech";
import { useDeepgramTranscription } from "@/hooks/useDeepgramTranscription";
import { useElevenLabsTTS } from "@/hooks/useElevenLabsTTS";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";

// When true, voice input routes through Deepgram's noise-robust Nova streaming
// model instead of the browser Web Speech API. Off by default so local
// development without a Deepgram key continues to work.
const DEEPGRAM_ENABLED = import.meta.env.VITE_DEEPGRAM_STT_ENABLED === "true";

export function useCenaivaVoice() {
  const { dispatch, state } = useAssistantStore();
  const speech = useCenaivaSpeech();
  const deepgram = useDeepgramTranscription();
  const elevenlabs = useElevenLabsTTS();

  const elEnabledFlag = import.meta.env.VITE_ELEVENLABS_ENABLED !== "false";
  const listeningRef = useRef(false);
  const manualStopRef = useRef(false);
  // Once Deepgram has failed once in this session (bad token scope, bad
  // WebSocket handshake, etc.) we stop trying it for the rest of the session.
  // This prevents every subsequent listen from triggering a fresh round of
  // "WebSocket connection failed" browser errors + fallback log noise.
  const deepgramDisabledRef = useRef(false);
  // Same pattern for ElevenLabs: if the edge function 503s (no key / quota /
  // misconfigured) once, skip it for the rest of the session and go straight
  // to Web Speech. Keeps TTS responsive instead of adding 2 network round-trips
  // of latency before every utterance.
  const elevenDisabledRef = useRef(false);

  const startListening = useCallback(async (): Promise<{ transcript: string; stopped: boolean }> => {
    if (listeningRef.current) return { transcript: "", stopped: false };
    listeningRef.current = true;
    manualStopRef.current = false;

    if (elevenlabs.isSpeaking) {
      elevenlabs.stop();
    } else if (speech.isSpeaking) {
      speech.stopSpeaking();
    }

    dispatch({ type: "SET_VOICE_STATUS", status: "listening" });

    try {
      let transcript: string;
      if (DEEPGRAM_ENABLED && deepgram.isSupported && !deepgramDisabledRef.current) {
        try {
          transcript = await deepgram.startRecognition();
        } catch (err) {
          // On Deepgram-specific failures (token, socket, worklet) fall back
          // to Web Speech so the user is never stranded without STT. We
          // re-throw permission errors so the caller can render the grant-
          // access UI.
          const msg = (err as Error)?.message ?? "";
          if (msg === "not-allowed" || msg.includes("not-allowed")) throw err;
          deepgramDisabledRef.current = true;
          transcript = await speech.startRecognition();
        }
      } else {
        transcript = await speech.startRecognition();
      }

      if (!manualStopRef.current) {
        dispatch({ type: "SET_VOICE_STATUS", status: "processing" });
      }
      return { transcript, stopped: manualStopRef.current };
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
    }
  }, [dispatch, speech, deepgram, elevenlabs]);

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    listeningRef.current = false;
    // Always stop both backends — stopping an idle one is a no-op and this
    // avoids any race where we disabled the wrong recognizer.
    speech.stopRecognition();
    deepgram.stopRecognition();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, speech, deepgram]);

  const speak = useCallback(
    async (text: string) => {
      if (!text) return;
      dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });

      let played = false;
      if (elEnabledFlag && !elevenDisabledRef.current) {
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
        // Two failures in a row → treat ElevenLabs as unavailable for the rest
        // of the session (no API key, quota exhausted, etc.) and skip straight
        // to Web Speech on subsequent turns.
        if (!played) {
          elevenDisabledRef.current = true;
        }
      }
      if (!played) {
        await speech.speak(text);
      }

      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    },
    [dispatch, elevenlabs, speech, elEnabledFlag],
  );

  const stopSpeaking = useCallback(() => {
    elevenlabs.stop();
    speech.stopSpeaking();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, elevenlabs, speech]);

  return {
    startListening,
    stopListening,
    speak,
    stopSpeaking,
    primeTTS: speech.primeTTS,
    voiceStatus: state.voiceStatus,
    isRecognitionSupported:
      (DEEPGRAM_ENABLED && deepgram.isSupported) || speech.isRecognitionSupported,
    isSpeaking: elevenlabs.isSpeaking || speech.isSpeaking,
    isRecording: speech.isRecording || deepgram.isRecording,
  };
}

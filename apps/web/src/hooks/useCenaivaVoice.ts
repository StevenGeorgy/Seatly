import { useCallback, useRef } from "react";
import { useCenaivaSpeech } from "@/hooks/useCenaivaSpeech";
import { useElevenLabsTTS } from "@/hooks/useElevenLabsTTS";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";

export function useCenaivaVoice() {
  const { dispatch, state } = useAssistantStore();
  const speech = useCenaivaSpeech();
  const elevenlabs = useElevenLabsTTS();

  // Track whether ElevenLabs is configured (non-null API key via edge function)
  const elEnabled = import.meta.env.VITE_ELEVENLABS_ENABLED !== "false";
  const listeningRef = useRef(false);
  const manualStopRef = useRef(false);

  const startListening = useCallback(async (): Promise<{ transcript: string; stopped: boolean }> => {
    if (listeningRef.current) return { transcript: "", stopped: false };
    listeningRef.current = true;
    manualStopRef.current = false;

    // Interrupt TTS if speaking
    if (elevenlabs.isSpeaking) {
      elevenlabs.stop();
    } else if (speech.isSpeaking) {
      speech.stopSpeaking();
    }

    dispatch({ type: "SET_VOICE_STATUS", status: "listening" });

    try {
      const transcript = await speech.startRecognition();
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
  }, [dispatch, speech, elevenlabs]);

  const stopListening = useCallback(() => {
    manualStopRef.current = true;
    listeningRef.current = false;
    speech.stopRecognition();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, speech]);

  const speak = useCallback(
    async (text: string) => {
      if (!text) return;
      dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });

      let played = false;
      if (elEnabled) {
        try {
          played = await elevenlabs.speak(text);
        } catch {
          played = false;
        }
      }
      // Fall back to Web Speech if ElevenLabs is disabled or failed
      if (!played) {
        await speech.speak(text);
      }

      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    },
    [dispatch, elevenlabs, speech, elEnabled],
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
    voiceStatus: state.voiceStatus,
    isRecognitionSupported: speech.isRecognitionSupported,
    isSpeaking: elevenlabs.isSpeaking || speech.isSpeaking,
    isRecording: speech.isRecording,
  };
}

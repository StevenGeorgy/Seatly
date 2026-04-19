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

  const startListening = useCallback(async (): Promise<string> => {
    if (listeningRef.current) return "";
    listeningRef.current = true;

    // Interrupt TTS if speaking
    if (elevenlabs.isSpeaking) {
      elevenlabs.stop();
    } else if (speech.isSpeaking) {
      speech.stopSpeaking();
    }

    dispatch({ type: "SET_VOICE_STATUS", status: "listening" });

    try {
      const transcript = await speech.startRecognition();
      dispatch({ type: "SET_VOICE_STATUS", status: "processing" });
      return transcript;
    } catch {
      dispatch({ type: "SET_VOICE_STATUS", status: "error" });
      return "";
    } finally {
      listeningRef.current = false;
    }
  }, [dispatch, speech, elevenlabs]);

  const stopListening = useCallback(() => {
    listeningRef.current = false;
    speech.stopRecognition();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, speech]);

  const speak = useCallback(
    async (text: string) => {
      if (!text) return;
      dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });

      if (elEnabled) {
        await elevenlabs.speak(text);
      } else {
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

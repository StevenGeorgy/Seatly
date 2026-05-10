import { useCallback, useRef, useState } from "react";
import { useCenaivaSpeech } from "@/hooks/useCenaivaSpeech";
import { useDeepgramTranscription } from "@/hooks/useDeepgramTranscription";
import { useElevenLabsTTS } from "@/hooks/useElevenLabsTTS";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useCenaivaVoicePreference } from "@/hooks/useCenaivaVoicePreference";

// When not explicitly disabled, route command voice input through Deepgram's
// Nova transcription path. Browser STT fallback is intentionally disabled so
// Cenaiva never routes command recognition through Web Speech.
const DEEPGRAM_ENABLED = import.meta.env.VITE_DEEPGRAM_STT_ENABLED !== "false";

export function useCenaivaVoice() {
  const { dispatch, state } = useAssistantStore();
  const voicePref = useCenaivaVoicePreference();
  const speech = useCenaivaSpeech();
  const deepgram = useDeepgramTranscription();
  const elevenlabs = useElevenLabsTTS({ voiceId: voicePref.voiceId });

  const elEnabledFlag = import.meta.env.VITE_ELEVENLABS_ENABLED !== "false";
  const listeningRef = useRef(false);
  const manualStopRef = useRef(false);
  // ElevenLabs cooldown: if the edge function 503s (transient 429 / quota /
  // network blip) twice in a row, skip it for 60 seconds then retry
  // automatically. Stored as state so isStreamingTTSAvailable can be computed
  // purely from props/state during render (no Date.now() / ref read at render
  // time). The cooldown self-heals — a setTimeout flips it back enabled
  // after ELEVEN_COOLDOWN_MS so subsequent turns try ElevenLabs again.
  const [elevenAvailable, setElevenAvailable] = useState(true);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ELEVEN_COOLDOWN_MS = 60_000;

  const startListening = useCallback(async (sttHints: string[] = []): Promise<{ transcript: string; stopped: boolean }> => {
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
      if (DEEPGRAM_ENABLED && deepgram.isSupported) {
        try {
          transcript = await deepgram.startRecognition(sttHints);
        } catch (err) {
          // Never fall back to browser speech recognition. Deepgram failures
          // surface upward so the UI can fail closed instead of silently
          // switching to Google/Chrome transcription.
          const msg = (err as Error)?.message ?? "";
          if (msg === "not-allowed" || msg.includes("not-allowed")) throw err;
          throw new Error(`deepgram-stt-unavailable:${msg || "unknown"}`);
        }
      } else {
        throw new Error("voice-stt-unavailable");
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
      if (elEnabledFlag && elevenAvailable) {
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
        // Two failures in a row → back off ElevenLabs for 60s and route this
        // turn through Web Speech. After the cooldown window we flip back to
        // available automatically (self-healing on transient 429s / network
        // blips). console.warn surfaces the fallback so developers can see
        // when ElevenLabs is temporarily disabled instead of silently
        // wondering why the voice changed.
        if (!played) {
          console.warn(
            "[Cenaiva TTS] ElevenLabs failed twice — falling back to Web Speech for 60s",
          );
          setElevenAvailable(false);
          if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
          cooldownTimerRef.current = setTimeout(() => {
            setElevenAvailable(true);
            cooldownTimerRef.current = null;
          }, ELEVEN_COOLDOWN_MS);
        }
      }
      if (!played) {
        await speech.speak(text);
      }

      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    },
    [dispatch, elevenlabs, speech, elEnabledFlag, elevenAvailable],
  );

  const stopSpeaking = useCallback(() => {
    elevenlabs.stop();
    speech.stopSpeaking();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [dispatch, elevenlabs, speech]);

  // ── Streaming TTS (phone-call pacing) ─────────────────────────────────────
  // Available only when ElevenLabs is enabled. Web Speech doesn't have a
  // safe queued-streaming primitive that works consistently across browsers,
  // so the fallback path skips streaming and the caller speaks the full
  // final text in one shot. Mirrors the cooldown gating in speak() so that
  // streaming chunks resume automatically after the 60s window passes.
  const isStreamingTTSAvailable = elEnabledFlag && elevenAvailable;

  const speakStreamingChunk = useCallback(
    (text: string) => {
      if (!isStreamingTTSAvailable) return;
      dispatch({ type: "SET_VOICE_STATUS", status: "speaking" });
      elevenlabs.speakQueued(text);
    },
    [dispatch, elevenlabs, isStreamingTTSAvailable],
  );

  const discardStreamingSpeech = useCallback(() => {
    elevenlabs.discardQueued();
  }, [elevenlabs]);

  const drainStreamingSpeech = useCallback(async () => {
    await elevenlabs.drainQueue();
    dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
  }, [elevenlabs, dispatch]);

  // primeTTS bundles both halves of "first-utterance latency": Safari/Chrome
  // audio-context unlock (speech.primeTTS, fast, sync) + IDB common-phrase
  // cache warm-up (elevenlabs.primeCache, async, fire-and-forget).
  const primeTTS = useCallback(() => {
    speech.primeTTS();
    void elevenlabs.primeCache();
  }, [speech, elevenlabs]);

  return {
    startListening,
    stopListening,
    speak,
    speakStreamingChunk,
    discardStreamingSpeech,
    drainStreamingSpeech,
    isStreamingTTSAvailable,
    stopSpeaking,
    primeTTS,
    voiceStatus: state.voiceStatus,
    isRecognitionSupported: DEEPGRAM_ENABLED && deepgram.isSupported,
    isSpeaking: elevenlabs.isSpeaking || speech.isSpeaking,
    isRecording: speech.isRecording || deepgram.isRecording,
  };
}

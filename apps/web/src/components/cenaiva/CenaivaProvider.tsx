import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useCenaivaChat, type ChatMessage, type ActionTaken } from "@/hooks/useCenaivaChat";
import { useCenaivaSpeech } from "@/hooks/useCenaivaSpeech";
import { useCenaivaWakeWord } from "@/hooks/useCenaivaWakeWord";

// Regex that matches phonetic variants of "Cenaiva" (with or without "hey")
// at the start of a captured STT command. Replaces them with "Cenaiva" so the
// chat bubble always shows the canonical spelling.
const WAKE_VARIANT_RE =
  /^(?:hey[\s,]+)?(?:cenaiva|senaiva|seneva|ceneva|soneva|caniva|ceniva|cenefa|siniva|sineva|sinaiva|syneva|syniva|senai|cenai|sinai|saniva|sonaiva|naiva|synova|hastenova|geneva|chennaiwa|cheniva|canova|son\s+iva|son\s+eva|son\s+either|son\s+over|sin\s+iva|sin\s+eva|sin\s+eye\s+va|sinai\s+va|seen\s+eva|hey\s+sana|hey\s+sene)[\s,]*/i;

function normalizeTranscript(transcript: string): string {
  if (WAKE_VARIANT_RE.test(transcript)) {
    return transcript.replace(WAKE_VARIANT_RE, "Cenaiva, ").trim();
  }
  return transcript;
}

type CenaivaStatus = "idle" | "listening" | "thinking" | "speaking";

type CenaivaContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  status: CenaivaStatus;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
  // Voice
  startVoiceInput: () => Promise<void>;
  stopVoiceInput: () => void;
  isRecording: boolean;
  ttsEnabled: boolean;
  setTtsEnabled: (v: boolean) => void;
  isRecognitionSupported: boolean;
  // Voice mode (continuous STT loop, active when session started via wake word)
  voiceMode: boolean;
  // Wake word
  wakeWordEnabled: boolean;
  toggleWakeWord: () => void;
  isWakeWordSupported: boolean;
  // Restaurant context
  restaurantId: string | null;
  setRestaurantId: (id: string | null) => void;
  // Mode: "customer" (default) or "owner" (dashboard)
  mode: "customer" | "owner";
  setMode: (mode: "customer" | "owner") => void;
};

const CenaivaContext = createContext<CenaivaContextValue | null>(null);

export function useCenaiva(): CenaivaContextValue | null {
  return useContext(CenaivaContext);
}

export function CenaivaProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // TTS off by default — user can enable via the speaker toggle in the drawer
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [mode, setMode] = useState<"customer" | "owner">("customer");
  // voiceMode = continuous STT loop; true when session was started via wake word
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);

  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  const chat = useCenaivaChat();
  const speech = useCenaivaSpeech();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    speech.stopRecognition();
    speech.stopSpeaking();
    setVoiceMode(false);
    setIsOpen(false);
  }, [speech]);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  // Refs to break circular deps: handleWakeWord → wakeWord → handleWakeWord.
  const wakeWordRef = useRef<{
    setEnabled: (v: boolean) => void;
    forceStop: () => void;
    isSupported: boolean;
  } | null>(null);
  // startVoiceInputRef lets handleWakeWord / sendMessage call the latest
  // startVoiceInput without it being listed as a dep (which would cause churn).
  const startVoiceInputRef = useRef<() => Promise<void>>(async () => {});
  // Guard: prevents concurrent startVoiceInput calls (e.g. wake word 800ms timer
  // firing while the user already manually clicked the mic button).
  const voiceInputInProgressRef = useRef(false);

  const sendMessage = useCallback(
    async (text: string) => {
      const result = await chat.sendMessage(text, {
        restaurantId: restaurantId || undefined,
        language: "en",
        mode,
      });
      // Speak the reply if TTS is on
      if (result?.reply && ttsEnabled) {
        await speech.speak(result.reply);
        // Wait for speaker audio to fully fade before reopening the mic.
        // Without this pause the STT picks up the TTS output as user speech.
        await new Promise<void>((r) => setTimeout(r, 700));
      }
      // Voice-mode restart is owned by startVoiceInput's finally block —
      // calling it here races with the inProgress guard and silently no-ops.
    },
    [chat, restaurantId, ttsEnabled, speech],
  );

  const startVoiceInput = useCallback(async () => {
    // Prevent concurrent calls: wake word timer and manual mic click can race.
    if (voiceInputInProgressRef.current) return;
    voiceInputInProgressRef.current = true;
    try {
      // Synchronously stop the wake word recognizer to free the mic.
      wakeWordRef.current?.forceStop();

      // Give Chrome time to fully release the mic hardware before claiming it.
      await new Promise<void>((r) => setTimeout(r, 350));

      const transcript = await speech.startRecognition();
      if (transcript) {
        await sendMessage(normalizeTranscript(transcript));
      }
      // Empty transcript: fall through to finally which restarts if in voice mode
    } catch (err: any) {
      // Mic permission denied — can't continue, exit voice mode
      if (err?.message === "not-allowed" || err?.message === "audio-capture") {
        voiceModeRef.current = false;
        setVoiceMode(false);
      }
      // Other errors: finally will restart if voice mode is still on
    } finally {
      // Clear the guard FIRST, then decide whether to restart.
      // If the restart call happened before this (e.g. inside sendMessage) it
      // would silently no-op because the flag was still true — that's the bug
      // this structure fixes.
      voiceInputInProgressRef.current = false;
      if (voiceModeRef.current) {
        // Voice mode still active: immediately queue next listening turn
        startVoiceInputRef.current();
      } else if (wakeWordRef.current?.isSupported) {
        // Voice mode off: hand the mic back to the wake word listener
        setTimeout(() => wakeWordRef.current?.setEnabled(true), 500);
      }
    }
  }, [speech, sendMessage]);

  // Keep ref current so handleWakeWord / sendMessage always call the latest version
  useEffect(() => {
    startVoiceInputRef.current = startVoiceInput;
  }, [startVoiceInput]);

  // Stop recording and exit the continuous voice loop
  const stopVoiceInput = useCallback(() => {
    voiceModeRef.current = false; // sync ref immediately; state update is async
    setVoiceMode(false);
    speech.stopRecognition();
    speech.stopSpeaking();
    // Re-enable wake word now that voice mode is done
    if (wakeWordRef.current?.isSupported) {
      setTimeout(() => wakeWordRef.current?.setEnabled(true), 500);
    }
  }, [speech]);

  // When wake word fires: enter voice mode, open drawer, free the mic, then
  // start capturing the user's voice command.
  // Stable (deps = []) — all state access is via refs and React setters.
  const handleWakeWord = useCallback(() => {
    voiceModeRef.current = true; // sync ref immediately; state update is async
    setVoiceMode(true);
    setIsOpen(true);
    wakeWordRef.current?.forceStop();
    // 800ms: enough for Chrome to fire onend on the wake recognizer and fully
    // release the mic hardware before startVoiceInput tries to claim it.
    setTimeout(() => startVoiceInputRef.current(), 800);
  }, []); // stable — all state access via refs/setters

  const wakeWord = useCenaivaWakeWord(handleWakeWord);

  // Keep wakeWordRef in sync with the latest methods / flags
  useEffect(() => {
    wakeWordRef.current = {
      setEnabled: wakeWord.setEnabled,
      forceStop: wakeWord.forceStop,
      isSupported: wakeWord.isSupported,
    };
  }, [wakeWord.setEnabled, wakeWord.forceStop, wakeWord.isSupported]);

  // Auto-enable wake word as soon as the browser supports it.
  useEffect(() => {
    if (wakeWord.isSupported && !wakeWord.enabled) {
      wakeWord.setEnabled(true);
    }
  }, [wakeWord.isSupported]); // eslint-disable-line react-hooks/exhaustive-deps

  const status: CenaivaStatus = useMemo(() => {
    if (speech.isRecording) return "listening";
    if (chat.loading) return "thinking";
    if (speech.isSpeaking) return "speaking";
    return "idle";
  }, [speech.isRecording, chat.loading, speech.isSpeaking]);

  const value = useMemo<CenaivaContextValue>(
    () => ({
      isOpen,
      open,
      close,
      toggle,
      status,
      messages: chat.messages,
      loading: chat.loading,
      error: chat.error,
      sendMessage,
      clearConversation: chat.clearConversation,
      startVoiceInput,
      stopVoiceInput,
      isRecording: speech.isRecording,
      ttsEnabled,
      setTtsEnabled,
      isRecognitionSupported: speech.isRecognitionSupported,
      voiceMode,
      wakeWordEnabled: wakeWord.enabled,
      toggleWakeWord: wakeWord.toggle,
      isWakeWordSupported: wakeWord.isSupported,
      restaurantId,
      setRestaurantId,
      mode,
      setMode,
    }),
    [
      isOpen, open, close, toggle, status,
      chat.messages, chat.loading, chat.error,
      sendMessage, chat.clearConversation,
      startVoiceInput, stopVoiceInput, speech.isRecording,
      ttsEnabled, speech.isRecognitionSupported,
      voiceMode,
      wakeWord.enabled, wakeWord.toggle, wakeWord.isSupported,
      restaurantId, mode,
    ],
  );

  return (
    <CenaivaContext.Provider value={value}>{children}</CenaivaContext.Provider>
  );
}

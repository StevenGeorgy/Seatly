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
};

const CenaivaContext = createContext<CenaivaContextValue | null>(null);

export function useCenaiva(): CenaivaContextValue | null {
  return useContext(CenaivaContext);
}

export function CenaivaProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  // Default TTS on so Cenaiva speaks responses aloud immediately
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
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

  const sendMessage = useCallback(
    async (text: string) => {
      const result = await chat.sendMessage(text, {
        restaurantId: restaurantId || undefined,
        language: "en",
      });
      // Speak the reply if TTS is on
      if (result?.reply && ttsEnabled) {
        await speech.speak(result.reply);
        // Wait for speaker audio to fully fade before reopening the mic.
        // Without this pause the STT picks up the TTS output as user speech.
        await new Promise<void>((r) => setTimeout(r, 700));
      }
      // In voice mode: automatically restart STT for the next turn
      if (voiceModeRef.current) {
        startVoiceInputRef.current();
      }
    },
    [chat, restaurantId, ttsEnabled, speech],
  );

  const startVoiceInput = useCallback(async () => {
    try {
      // Synchronously stop the wake word recognizer to free the mic.
      wakeWordRef.current?.forceStop();

      // Give Chrome time to fully release the mic hardware.
      // 350ms is the safe minimum observed across devices; wake-word path adds
      // another 800ms on top (see handleWakeWord), so total is ~1150ms.
      await new Promise<void>((r) => setTimeout(r, 350));

      const transcript = await speech.startRecognition();
      if (transcript) {
        // sendMessage will restart STT automatically if voiceMode is still on
        await sendMessage(normalizeTranscript(transcript));
      } else if (voiceModeRef.current) {
        // No speech detected — stay in the loop
        startVoiceInputRef.current();
      }
    } catch {
      if (voiceModeRef.current) {
        setTimeout(() => startVoiceInputRef.current(), 1000);
      }
    } finally {
      // Re-enable wake word only when we've fully exited voice mode
      if (!voiceModeRef.current && wakeWordRef.current?.isSupported) {
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
    setVoiceMode(false);
    speech.stopRecognition();
    speech.stopSpeaking();
    // Re-enable wake word now that voice mode is done
    if (wakeWordRef.current?.isSupported) {
      setTimeout(() => wakeWordRef.current?.setEnabled(true), 500);
    }
  }, [speech]);

  // When wake word fires: enter voice mode, open drawer, ensure TTS is on,
  // free the mic, then start capturing the user's voice command.
  // Stable (deps = []) — all state access is via refs and React setters.
  const handleWakeWord = useCallback(() => {
    setTtsEnabled(true);
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
    }),
    [
      isOpen, open, close, toggle, status,
      chat.messages, chat.loading, chat.error,
      sendMessage, chat.clearConversation,
      startVoiceInput, stopVoiceInput, speech.isRecording,
      ttsEnabled, speech.isRecognitionSupported,
      voiceMode,
      wakeWord.enabled, wakeWord.toggle, wakeWord.isSupported,
      restaurantId,
    ],
  );

  return (
    <CenaivaContext.Provider value={value}>{children}</CenaivaContext.Provider>
  );
}

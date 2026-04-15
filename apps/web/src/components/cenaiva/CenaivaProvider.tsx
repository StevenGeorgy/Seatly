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

  const chat = useCenaivaChat();
  const speech = useCenaivaSpeech();

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    speech.stopRecognition();
    speech.stopSpeaking();
    setIsOpen(false);
  }, [speech]);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);

  const sendMessage = useCallback(
    async (text: string) => {
      const result = await chat.sendMessage(text, {
        restaurantId: restaurantId || undefined,
        language: "en",
      });
      // Speak the reply if TTS is on
      if (result?.reply && ttsEnabled) {
        await speech.speak(result.reply);
      }
    },
    [chat, restaurantId, ttsEnabled, speech],
  );

  // Refs to break circular deps: handleWakeWord → wakeWord → handleWakeWord.
  // wakeWordRef lets startVoiceInput pause/resume the wake listener without
  // taking it as a dep (which would churn handleWakeWord's identity).
  const wakeWordRef = useRef<{
    setEnabled: (v: boolean) => void;
    forceStop: () => void;
    isSupported: boolean;
  } | null>(null);
  // startVoiceInputRef lets handleWakeWord call the latest startVoiceInput
  // without listing it as a dep (which would churn handleWakeWord's identity
  // and in turn restart the underlying SpeechRecognition on every render).
  const startVoiceInputRef = useRef<() => Promise<void>>(async () => {});

  const startVoiceInput = useCallback(async () => {
    try {
      // Synchronously stop the wake word recognizer to free the mic.
      // setEnabled(false) queues a React state update which only runs after
      // the next render — too slow. forceStop() clears the instance now.
      wakeWordRef.current?.forceStop();

      // Give Chrome ~200ms to fully release the mic hardware after the wake
      // recognizer stops. Without this delay Chrome rejects the new start()
      // and immediately fires onend, making the mic button appear to unclick.
      await new Promise<void>((r) => setTimeout(r, 200));

      const transcript = await speech.startRecognition();
      if (transcript) {
        await sendMessage(transcript);
      }
    } catch {
      // Recognition failed — wake word will re-enable below
    } finally {
      // Re-enable wake word after voice input completes
      if (wakeWordRef.current?.isSupported) {
        setTimeout(() => wakeWordRef.current?.setEnabled(true), 500);
      }
    }
  }, [speech, sendMessage]);

  // Keep ref current so handleWakeWord always calls the latest version
  useEffect(() => {
    startVoiceInputRef.current = startVoiceInput;
  }, [startVoiceInput]);

  // When wake word fires: open drawer, ensure TTS is on, free the mic,
  // then start capturing the user's voice command.
  // Stable (deps = []) — all state access is via refs and React setters.
  const handleWakeWord = useCallback(() => {
    setTtsEnabled(true);
    setIsOpen(true);
    // Free the mic immediately; startVoiceInput will also call forceStop
    // but that's after the 400ms delay — this prevents the onend restart timer
    wakeWordRef.current?.forceStop();
    // Brief delay so Chrome fully releases the mic before the command recognizer
    setTimeout(() => startVoiceInputRef.current(), 400);
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
  // No auth gate — the chat layer already shows "Please sign in to use
  // Cenaiva." if the user isn't authenticated.
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
      stopVoiceInput: speech.stopRecognition,
      isRecording: speech.isRecording,
      ttsEnabled,
      setTtsEnabled,
      isRecognitionSupported: speech.isRecognitionSupported,
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
      startVoiceInput, speech.stopRecognition, speech.isRecording,
      ttsEnabled, speech.isRecognitionSupported,
      wakeWord.enabled, wakeWord.toggle, wakeWord.isSupported,
      restaurantId,
    ],
  );

  return (
    <CenaivaContext.Provider value={value}>{children}</CenaivaContext.Provider>
  );
}

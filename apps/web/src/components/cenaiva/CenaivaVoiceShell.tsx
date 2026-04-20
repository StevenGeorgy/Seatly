import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { usePublicRestaurants } from "@/hooks/useRestaurant";
import { useUser } from "@/hooks/useUser";
import { VoiceOrb } from "@/components/cenaiva/VoiceOrb";
import { CustomerMap } from "@/components/cenaiva/CustomerMap";
import { RestaurantRail } from "@/components/cenaiva/RestaurantRail";
import { BookingSheet } from "@/components/cenaiva/BookingSheet";
import { ExitButton } from "@/components/cenaiva/ExitButton";

interface CenaivaVoiceShellProps {
  /** When true, plays a hard-coded opening greeting as soon as the shell opens */
  initialGreeting?: boolean;
}

export function CenaivaVoiceShell({ initialGreeting }: CenaivaVoiceShellProps) {
  const { state, dispatch } = useAssistantStore();
  const assistant = useAssistant();
  const voice = useCenaivaVoice();
  const { profile } = useUser();
  const { restaurants } = usePublicRestaurants();

  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const greetedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpenRef = useRef(state.isOpen);

  // Keep isOpenRef current for post-greeting auto-listen check
  useEffect(() => {
    isOpenRef.current = state.isOpen;
  }, [state.isOpen]);

  // Client-side greeting — no LLM roundtrip, instant playback
  useEffect(() => {
    if (!initialGreeting) return;
    if (!state.isOpen) {
      greetedRef.current = false;
      return;
    }
    if (greetedRef.current) return;
    greetedRef.current = true;

    const firstName = profile?.full_name?.split(" ")[0] ?? "there";
    const greeting = `Hey, ${firstName}! How can I help you?`;
    dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: greeting });
    void (async () => {
      await voice.speak(greeting);
      // After greeting, start listening automatically
      if (isOpenRef.current) {
        void assistant?.startListening();
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGreeting, state.isOpen]);

  const handleOrbClick = () => {
    if (state.voiceStatus === "listening") {
      voice.stopListening();
    } else if (state.voiceStatus === "speaking") {
      voice.stopSpeaking();
    } else {
      void assistant?.startListening();
    }
  };

  const [sendError, setSendError] = useState<string | null>(null);

  const handleTextSend = useCallback(async () => {
    const t = textInput.trim();
    if (!t) return;
    setTextInput("");
    setSendError(null);
    try {
      await assistant?.sendTranscript(t);
    } catch {
      setSendError("Something went wrong. Try again.");
    }
  }, [textInput, assistant]);

  const handleKeyboardToggle = useCallback(() => {
    const entering = !showTextInput;
    if (entering) {
      // Stop mic before showing keyboard — prevents Chrome from firing a recognition error
      voice.stopListening();
      assistant?.setTextMode(true);
    } else {
      assistant?.setTextMode(false);
      setSendError(null);
    }
    setShowTextInput(entering);
    if (entering) setTimeout(() => inputRef.current?.focus(), 50);
  }, [showTextInput, voice, assistant]);

  const handleClose = () => {
    assistant?.close();
  };

  const bookingActive =
    state.booking.status !== "idle" && state.booking.status !== "collecting_minimum_fields";
  const showConfirmationOrPostBooking =
    state.booking.status === "confirmed" ||
    state.booking.status === "post_booking" ||
    state.booking.status === "offering_preorder" ||
    state.booking.status === "browsing_menu" ||
    state.booking.status === "reviewing_cart" ||
    state.booking.status === "choosing_tip_timing" ||
    state.booking.status === "choosing_tip_amount" ||
    state.booking.status === "choosing_payment_split" ||
    state.booking.status === "charging" ||
    state.booking.status === "paid";

  return (
    <AnimatePresence>
      {state.isOpen && (
        <motion.div
          key="voice-shell"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 bg-[#0A0A0A] flex flex-col overflow-hidden"
        >
          {/* Close button — hidden once ExitButton takes over */}
          {!showConfirmationOrPostBooking && (
            <button
              onClick={handleClose}
              className="absolute top-4 left-4 z-50 flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              aria-label="Close assistant"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          )}

          {/* Map layer */}
          <div className={cn("flex-1 relative", bookingActive && "h-[45%] flex-none")}>
            {state.map.visible || true ? (
              <CustomerMap restaurants={restaurants} />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-[#111]">
                <div className="text-center">
                  <p className="text-5xl mb-3">🗺️</p>
                  <p className="text-white/30 text-sm">Ask for a restaurant to see the map</p>
                </div>
              </div>
            )}

            {/* Spoken text overlay */}
            <AnimatePresence>
              {state.lastSpokenText && (
                <motion.div
                  key={state.lastSpokenText}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 w-[85%] max-w-sm"
                >
                  <div className="bg-black/70 backdrop-blur-sm rounded-2xl px-4 py-2.5 text-white text-sm text-center font-medium border border-white/10">
                    {state.lastSpokenText}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Restaurant rail — hidden during advanced booking/payment steps */}
          {!showConfirmationOrPostBooking && (
            <div className="bg-[#0D0D0D] border-t border-white/5 py-2">
              <RestaurantRail restaurants={restaurants} />
              {restaurants.length === 0 && (
                <p className="text-center text-white/20 text-xs py-3 px-4">
                  Speak to discover restaurants near you
                </p>
              )}
            </div>
          )}

          {/* Booking sheet overlay */}
          <div className="relative">
            <BookingSheet onExit={handleClose} />
          </div>

          {/* Voice orb + text input strip */}
          <div className="bg-[#0D0D0D] border-t border-white/10 px-4 py-4 flex items-center gap-3">
            <VoiceOrb
              status={state.voiceStatus}
              onClick={handleOrbClick}
            />

            {showTextInput ? (
              <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    value={textInput}
                    onChange={(e) => { setTextInput(e.target.value); setSendError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleTextSend(); }}
                    placeholder="Type a message…"
                    className="flex-1 bg-white/5 border border-white/15 rounded-full px-4 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#C8A951]"
                    autoFocus
                  />
                  <button
                    onClick={() => void handleTextSend()}
                    disabled={!textInput.trim() || state.voiceStatus === "processing"}
                    className="px-4 py-2.5 rounded-full bg-[#C8A951] text-black text-sm font-medium disabled:opacity-40 hover:bg-[#E6C060] transition-colors"
                  >
                    {state.voiceStatus === "processing" ? "…" : "Send"}
                  </button>
                </div>
                {sendError && (
                  <p className="text-red-400 text-xs px-2">{sendError}</p>
                )}
              </div>
            ) : (
              <div className="flex-1">
                <p className="text-white/50 text-sm">
                  {state.voiceStatus === "listening" && "Listening…"}
                  {state.voiceStatus === "processing" && "Thinking…"}
                  {state.voiceStatus === "speaking" && state.lastSpokenText}
                  {(state.voiceStatus === "idle" || state.voiceStatus === "interrupted") &&
                    'Tap the mic or say "Hey Cenaiva"'}
                  {state.voiceStatus === "error" && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.mediaDevices?.getUserMedia({ audio: true })
                          .then((s) => { s.getTracks().forEach((t) => t.stop()); dispatch({ type: "SET_VOICE_STATUS", status: "idle" }); })
                          .catch(() => {});
                      }}
                      className="text-[#C8A951] underline underline-offset-2"
                    >
                      Grant microphone access
                    </button>
                  )}
                </p>
              </div>
            )}

            <button
              onClick={handleKeyboardToggle}
              className={cn(
                "p-2.5 rounded-full border transition-colors",
                showTextInput
                  ? "bg-[#C8A951]/20 border-[#C8A951] text-[#C8A951]"
                  : "border-white/20 text-white/40 hover:border-white/40",
              )}
              aria-label="Toggle text input"
            >
              <Keyboard className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

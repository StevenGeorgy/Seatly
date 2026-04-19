import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { usePublicRestaurants } from "@/hooks/useRestaurant";
import { VoiceOrb } from "@/components/cenaiva/VoiceOrb";
import { CustomerMap } from "@/components/cenaiva/CustomerMap";
import { RestaurantRail } from "@/components/cenaiva/RestaurantRail";
import { BookingSheet } from "@/components/cenaiva/BookingSheet";
import { ExitButton } from "@/components/cenaiva/ExitButton";

interface CenaivaVoiceShellProps {
  /** When true, sends an opening greeting as soon as the shell mounts */
  initialGreeting?: boolean;
}

export function CenaivaVoiceShell({ initialGreeting }: CenaivaVoiceShellProps) {
  const { state, dispatch } = useAssistantStore();
  const assistant = useAssistant();
  const voice = useCenaivaVoice();
  const { restaurants } = usePublicRestaurants();

  const [textInput, setTextInput] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const greetedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fire initial greeting once
  useEffect(() => {
    if (initialGreeting && state.isOpen && !greetedRef.current) {
      greetedRef.current = true;
      void assistant?.sendTranscript("hello");
    }
  }, [initialGreeting, state.isOpen, assistant]);

  const handleOrbClick = () => {
    if (state.voiceStatus === "listening") {
      voice.stopListening();
    } else if (state.voiceStatus === "speaking") {
      voice.stopSpeaking();
    } else {
      void assistant?.startListening();
    }
  };

  const handleTextSend = () => {
    const t = textInput.trim();
    if (!t) return;
    setTextInput("");
    void assistant?.sendTranscript(t);
  };

  const handleClose = () => {
    assistant?.close();
  };

  const bookingActive =
    state.booking.status !== "idle" && state.booking.status !== "collecting_minimum_fields";
  const showConfirmationOrPostBooking =
    state.booking.status === "confirmed" ||
    state.booking.status === "post_booking";

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
          {/* Close button — always visible top-left UNLESS ExitButton takes over post-booking */}
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
            {state.map.visible || true /* always show map in shell */ ? (
              <CustomerMap restaurants={restaurants} />
            ) : (
              /* Placeholder when map not yet triggered */
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

          {/* Restaurant rail */}
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
              <div className="flex-1 flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleTextSend()}
                  placeholder="Type a message…"
                  className="flex-1 bg-white/5 border border-white/15 rounded-full px-4 py-2.5 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#C8A951]"
                  autoFocus
                />
                <button
                  onClick={handleTextSend}
                  disabled={!textInput.trim()}
                  className="px-4 py-2.5 rounded-full bg-[#C8A951] text-black text-sm font-medium disabled:opacity-40 hover:bg-[#E6C060] transition-colors"
                >
                  Send
                </button>
              </div>
            ) : (
              <div className="flex-1">
                <p className="text-white/50 text-sm">
                  {state.voiceStatus === "listening" && "Listening…"}
                  {state.voiceStatus === "processing" && "Thinking…"}
                  {state.voiceStatus === "speaking" && state.lastSpokenText}
                  {(state.voiceStatus === "idle" || state.voiceStatus === "interrupted") &&
                    'Tap the mic or say "Hey Cenaiva"'}
                  {state.voiceStatus === "error" && "Mic unavailable — try typing"}
                </p>
              </div>
            )}

            <button
              onClick={() => {
                setShowTextInput((v) => !v);
                if (!showTextInput) setTimeout(() => inputRef.current?.focus(), 50);
              }}
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

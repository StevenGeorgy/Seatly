import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { NOISE_ROBUST_AUDIO_CONSTRAINTS } from "@/hooks/useDeepgramTranscription";
import { usePublicRestaurants } from "@/hooks/useRestaurant";
import { useUser } from "@/hooks/useUser";
import { VoiceOrb } from "@/components/cenaiva/VoiceOrb";
import { CustomerMap } from "@/components/cenaiva/CustomerMap";
import { RestaurantRail } from "@/components/cenaiva/RestaurantRail";
import { BookingSheet, MANUAL_MENU_STATUSES } from "@/components/cenaiva/BookingSheet";

interface CenaivaVoiceShellProps {
  /** When true, plays a hard-coded opening greeting as soon as the shell opens */
  initialGreeting?: boolean;
}

// Module-level mount token used to distinguish a real unmount (route change /
// SPA exit) from React StrictMode's synthetic mount-cleanup-remount cycle in
// dev. The on-unmount cleanup compares against this token after a setTimeout(0)
// — if a fresh mount has replaced it, we know the cleanup was a false alarm
// and skip cancelling speech. Survives across the synthetic remount because
// it lives outside React's per-instance state.
let activeShellMountToken: object | null = null;

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

  // On unmount (route change away from the customer app) cancel any queued
  // speech + stop any active recognition. Without this, utterances keep
  // playing into the next page and the mic stream is held open.
  //
  // Deferred via setTimeout + a module-level token so React StrictMode's
  // synthetic mount → cleanup → remount cycle in dev does NOT cancel the
  // in-flight greeting. Without this guard the opener TTS reliably gets
  // cut off after the first word, because the spurious cleanup fires
  // window.speechSynthesis.cancel() between the two mounts.
  useEffect(() => {
    const token = {};
    activeShellMountToken = token;
    return () => {
      const captured = voice;
      setTimeout(() => {
        // A remount has replaced our token → this was a StrictMode/HMR
        // false unmount, skip the cancel.
        if (activeShellMountToken !== token) return;
        captured.stopSpeaking();
        captured.stopListening();
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
        }
      }, 0);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inManualMenu = MANUAL_MENU_STATUSES.has(state.booking.status);
  const speechHints = useMemo(() => {
    const visibleIds = new Set(state.map.marker_restaurant_ids ?? []);
    const visibleNames = restaurants
      .filter((restaurant) => visibleIds.has(restaurant.id))
      .map((restaurant) => restaurant.name);
    const hints = [
      state.booking.restaurant_name ?? "",
      ...visibleNames,
    ];
    if (state.map.highlighted_restaurant_id) {
      const highlighted = restaurants.find((restaurant) => restaurant.id === state.map.highlighted_restaurant_id);
      if (highlighted?.name) {
        hints.unshift(highlighted.name);
      }
    }
    return Array.from(new Set(hints.map((hint) => hint.trim()).filter(Boolean))).slice(0, 12);
  }, [
    restaurants,
    state.booking.restaurant_name,
    state.map.highlighted_restaurant_id,
    state.map.marker_restaurant_ids,
  ]);

  useEffect(() => {
    assistant?.setSpeechHints(speechHints);
  }, [assistant, speechHints]);

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
    // If the user is resuming an in-progress booking flow (shell was closed
    // mid-conversation), use a shorter resumption cue instead of the full
    // "How can I help?" opener — otherwise the LLM has to re-establish context
    // and the first turn feels like a fresh start when it shouldn't.
    const isResumingMidFlow =
      state.booking.status !== "idle" && state.booking.status !== "collecting_minimum_fields";
    const greeting = isResumingMidFlow
      ? `Hey, ${firstName}! Where were we?`
      : `Hey, ${firstName}! How can I help?`;
    dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: greeting });
    void (async () => {
      await voice.speak(greeting);
      // After greeting, start listening automatically — unless we're already
      // in the manual menu flow (pre-order offer / browsing menu), where the
      // user drives the UI with taps and only opts into the mic for ad-hoc
      // ingredient / allergen questions.
      if (
        isOpenRef.current &&
        assistant?.shouldAutoListenOnOpen() &&
        !MANUAL_MENU_STATUSES.has(state.booking.status)
      ) {
        void assistant?.startListening();
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGreeting, state.isOpen]);

  // When the booking transitions into the manual menu flow, hard-stop any
  // active listening so the mic doesn't keep running while the user taps
  // through the menu.
  useEffect(() => {
    if (inManualMenu) {
      voice.stopListening();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inManualMenu]);

  const handleOrbClick = () => {
    if (state.voiceStatus === "listening") {
      voice.stopListening();
    } else if (state.voiceStatus === "speaking") {
      voice.stopSpeaking();
    } else {
      // Prime the Web Speech audio pipeline inside this user-gesture callback
      // so the browser unlocks audio output before the first greeting/TTS call.
      voice.primeTTS();
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
  const hasSelectedRestaurant = !!state.booking.restaurant_id;

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

          {/* Map layer — hidden while the user is driving the manual menu
              flow so the menu can fill the screen. */}
          {!inManualMenu && (
            <div className="flex-1 relative">
              <CustomerMap restaurants={restaurants} />

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
          )}

          {/* Restaurant rail — hidden during advanced booking/payment steps */}
          {!showConfirmationOrPostBooking && !inManualMenu && !hasSelectedRestaurant && (
            <div className="bg-[#0D0D0D] border-t border-white/5">
              <RestaurantRail restaurants={restaurants} />
              {restaurants.length === 0 && (
                <p className="text-center text-white/20 text-xs py-3 px-4">
                  Speak to discover restaurants near you
                </p>
              )}
            </div>
          )}

          {/* Booking sheet — fills available space in manual menu flow so
              the menu isn't capped at 65% of the viewport. */}
          <div className={cn("relative", inManualMenu && "flex-1 min-h-0")}>
            <BookingSheet onExit={handleClose} fullScreen={inManualMenu} />
          </div>

          {/* Voice orb + text input strip */}
          <div className="mt-auto bg-[#0D0D0D] px-4 py-4 flex items-center gap-3">
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
                    (inManualMenu
                      ? "Tap the mic to ask about ingredients or allergens"
                      : 'Tap the mic or say "Hey Cenaiva"')}
                  {state.voiceStatus === "error" && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.mediaDevices?.getUserMedia({ audio: NOISE_ROBUST_AUDIO_CONSTRAINTS })
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

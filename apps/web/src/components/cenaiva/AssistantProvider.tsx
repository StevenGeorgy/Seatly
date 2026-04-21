import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { useCenaivaOrchestrator } from "@/hooks/useCenaivaOrchestrator";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { useVapiVoice } from "@/hooks/useVapiVoice";
import { useCenaivaWakeWord } from "@/hooks/useCenaivaWakeWord";
import { NOISE_ROBUST_AUDIO_CONSTRAINTS } from "@/hooks/useDeepgramTranscription";
import { useAssistantStore, AssistantStoreProvider } from "@/components/cenaiva/AssistantStore";
import { useUser } from "@/hooks/useUser";
import { useSavedCards } from "@/hooks/useSavedCards";
import type { AssistantResponseType, OrchestratorRequestType } from "@cenaiva/assistant";

// Opt into the Vapi pipeline (WebRTC + Deepgram + 11labs + barge-in) when
// both the public key and the assistant id are set. Falls back to the
// hand-rolled legacy loop if either is missing or the flag is off.
const VAPI_ENABLED =
  (import.meta.env.VITE_VOICE_PROVIDER ?? "vapi") === "vapi" &&
  !!import.meta.env.VITE_VAPI_PUBLIC_KEY &&
  !!import.meta.env.VITE_VAPI_ASSISTANT_ID;

// ── Context exposed to child components ───────────────────────────────────────

interface AssistantContextValue {
  open: (restaurantId?: string, restaurantName?: string) => void;
  close: () => void;
  /**
   * Speak a farewell line, then tear down the voice stack and navigate.
   * Defaults to /discover when not already there. Pass `redirectAfter` to
   * land elsewhere (e.g. public menu after accepting pre-order).
   */
  sayGoodbyeAndClose: (message?: string, redirectAfter?: string) => Promise<void>;
  sendTranscript: (transcript: string, opts?: { restaurantId?: string }) => Promise<void>;
  startListening: () => Promise<void>;
  setTextMode: (active: boolean) => void;
}

const AssistantCtx = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue | null {
  return useContext(AssistantCtx);
}

// ── Mic permission helper ─────────────────────────────────────────────────────

async function checkMicPermission(): Promise<PermissionState | null> {
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return result.state;
  } catch {
    return null;
  }
}

async function requestMicPermission(): Promise<boolean> {
  try {
    // Request with the same noise-robust constraints we'll use for
    // transcription so the browser surfaces a single permission prompt and
    // consistent DSP (echo cancellation, noise suppression, AGC).
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: NOISE_ROBUST_AUDIO_CONSTRAINTS,
    });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

// ── Inner provider (needs AssistantStore in tree) ─────────────────────────────

function AssistantInner({ children }: { children: ReactNode }) {
  const { state, dispatch } = useAssistantStore();
  const { user } = useUser();
  const { hasCard } = useSavedCards();
  const orchestrator = useCenaivaOrchestrator();
  const voice = useCenaivaVoice();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // Handler the Vapi hook invokes when the assistant's trailing
  // `apply_ui_response` tool call arrives — same dispatch path the legacy
  // sendTranscript uses below, minus the speak() step (Vapi handles TTS).
  const applyVapiResponse = useCallback(
    (response: AssistantResponseType) => {
      dispatch({ type: "APPLY_RESPONSE", response });
      for (const action of response.ui_actions ?? []) {
        if (!action || typeof action.type !== "string") continue;
        if (action.type === "toast") toast(action.message, { duration: 3000 });
        if (action.type === "navigate") navigate(action.path);
        if (action.type === "navigate_to_checkout") {
          dispatch({ type: "CLOSE" });
          navigate(action.path);
        }
      }
    },
    [dispatch, navigate],
  );

  const vapi = useVapiVoice({ onResponse: applyVapiResponse });

  // Customer voice stack (wake word, mic stream) only runs on authed customer routes.
  // Dashboard, landing, and auth routes skip all mic-related effects to keep memory flat.
  const VOICE_PUBLIC_PATHS = ["/", "/features", "/about", "/login", "/register", "/forgot-password", "/reset-password"];
  const isCustomerRoute =
    !!user &&
    !VOICE_PUBLIC_PATHS.includes(pathname) &&
    !pathname.startsWith("/auth/") &&
    !pathname.startsWith("/dashboard");

  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const processingRef = useRef(false);
  const micGrantedRef = useRef(false);
  const isOpenRef = useRef(false);
  const textModeRef = useRef(false);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  // Mirror state in a ref so sendTranscript always reads the *latest* booking
  // fields — not the snapshot from when the callback was defined. This was
  // the root cause of "AI keeps asking for party_size even after I answered":
  // the state had updated but sendTranscript's closure still saw party_size=null.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Consecutive relisten attempts that returned an empty transcript. If this
  // climbs, something is blocking mic capture (another recognizer has the
  // stream, permission glitched, InvalidStateError looping, etc.). Without a
  // cap the .then-chain can starve the main thread via microtasks → page hang.
  const emptyRelistenStreakRef = useRef(0);
  const MAX_EMPTY_RELISTENS = 3;

  // Sync hasCard into booking state so components and orchestrator requests can use it
  useEffect(() => {
    dispatch({ type: "SET_HAS_SAVED_CARD", value: hasCard });
  }, [hasCard, dispatch]);

  useEffect(() => {
    isOpenRef.current = state.isOpen;
  }, [state.isOpen]);

  // Prime the Web Speech audio pipeline on the FIRST user gesture anywhere on
  // the page. Chrome's autoplay policy blocks speechSynthesis until there's
  // been a user gesture in the tab — wake-word fires don't count. This
  // one-shot listener guarantees TTS works the moment the user clicks, taps,
  // or presses any key. Without it, the very first assistant reply is silent.
  const ttsPrimedRef = useRef(false);
  useEffect(() => {
    if (ttsPrimedRef.current) return;
    const prime = () => {
      if (ttsPrimedRef.current) return;
      ttsPrimedRef.current = true;
      try { voice.primeTTS(); } catch { /* noop */ }
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
      window.removeEventListener("touchstart", prime, true);
    };
    window.addEventListener("pointerdown", prime, true);
    window.addEventListener("keydown", prime, true);
    window.addEventListener("touchstart", prime, true);
    return () => {
      window.removeEventListener("pointerdown", prime, true);
      window.removeEventListener("keydown", prime, true);
      window.removeEventListener("touchstart", prime, true);
    };
  }, [voice]);

  const locationRequestedRef = useRef(false);

  const requestLocation = useCallback(() => {
    if (locationRequestedRef.current || !navigator.geolocation) return;
    locationRequestedRef.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userLocationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      },
      () => {
        locationRequestedRef.current = false;
      },
      { timeout: 15_000, maximumAge: 300_000 },
    );
  }, []);

  const sendTranscript = useCallback(
    async (transcript: string, opts?: { restaurantId?: string }) => {
      if (processingRef.current) return;

      // On the Vapi path, keyboard-mode text is pushed straight into the live
      // call as an `add-message` client→server frame. Vapi handles the rest
      // (LLM call → TTS → continued listening), so we early-return here.
      if (VAPI_ENABLED && vapi.isAvailable && vapi.isActive()) {
        vapi.sendText(transcript);
        return;
      }

      processingRef.current = true;

      // Hard-stop any active recognition before processing. This must happen on
      // THIS voice hook instance (the same one that started the recognizer) —
      // calling voice.stopListening() from child components targets a different
      // per-hook ref and leaves Chrome's SpeechRecognition running, which then
      // wedges the next listen cycle after the orchestrator replies.
      voice.stopListening();

      dispatch({ type: "SET_VOICE_STATUS", status: "processing" });

      const current = stateRef.current;
      const req: OrchestratorRequestType = {
        transcript,
        screen: "discover",
        booking_state: {
          restaurant_id: current.booking.restaurant_id,
          party_size: current.booking.party_size,
          date: current.booking.date,
          time: current.booking.time,
          shift_id: current.booking.shift_id,
          slot_iso: current.booking.slot_iso,
          status: current.booking.status,
          confirmation_code: current.booking.confirmation_code,
          reservation_id: current.booking.reservation_id,
          order_id: current.booking.order_id,
          tip_choice: current.booking.tip_choice,
          tip_amount: current.booking.tip_amount,
          tip_percent: current.booking.tip_percent,
          payment_split: current.booking.payment_split,
          payment_status: current.booking.payment_status,
          cart_subtotal: current.booking.cart_subtotal,
          cart: current.booking.cart,
        },
        map_state: {
          visible: current.map.visible,
          center: current.map.center,
          zoom: current.map.zoom,
          marker_restaurant_ids: current.map.marker_restaurant_ids,
        },
        filters: current.filters,
        visible_restaurant_ids: current.map.marker_restaurant_ids,
        selected_restaurant_id: opts?.restaurantId ?? current.booking.restaurant_id,
        user_location: userLocationRef.current,
        conversation_id: current.conversationId ?? undefined,
        has_saved_card: hasCard,
        guest_id: null,
        reservation_id: current.booking.reservation_id,
      };

      try {
        const response = await orchestrator.send(req);
        processingRef.current = false;

        if (!response) {
          // Orchestrator returned null (network / timeout / 500). Handle text
          // mode and voice mode differently: chat users can see a banner + toast,
          // voice users need an audible retry cue.
          const cause = orchestrator.lastErrorRef.current ?? "unknown";
          const friendly =
            cause === "timeout"
              ? "The assistant is taking a while. Try again."
              : cause === "not_authenticated"
                ? "Please sign in again to continue."
                : "Something went wrong. Try again.";
          if (textModeRef.current) {
            dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: friendly });
            toast.error(friendly, { duration: 3000 });
          } else {
            await voice.speak("Sorry, I didn't catch that. Try again.");
          }
          dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
          if (isOpenRef.current && !textModeRef.current) {
            setTimeout(() => {
              if (isOpenRef.current && !textModeRef.current) void startListeningRef.current();
            }, 150);
          }
          return;
        }

        dispatch({ type: "APPLY_RESPONSE", response });

        for (const action of (response.ui_actions ?? [])) {
          if (!action || typeof action.type !== "string") continue;
          if (action.type === "toast") toast(action.message, { duration: 3000 });
          if (action.type === "navigate") navigate(action.path);
          if (action.type === "navigate_to_checkout") {
            isOpenRef.current = false;
            voice.stopSpeaking();
            voice.stopListening();
            dispatch({ type: "CLOSE" });
            navigate(action.path);
          }
        }

        // The orchestrator is the single source of truth for spoken_text —
        // including the "Want to pre-order?" follow-up after a confirmation.
        // Don't rewrite what the LLM/server produced; just speak it.
        const spokenText = response.spoken_text ?? "";
        if (spokenText) await voice.speak(spokenText);
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });

        if (isOpenRef.current && !textModeRef.current) {
          // `await voice.speak()` already unblocks on the audio element's
          // `onended` event, so playback has finished by the time we reach
          // here. Use a tiny 150ms micro-grace only to let Chrome release the
          // audio stack lock before the next recognition.start() — any longer
          // and users notice a silent gap that breaks the "always listening"
          // feel.
          setTimeout(() => {
            if (isOpenRef.current && !textModeRef.current) {
              void startListeningRef.current();
            }
          }, 150);
        }
      } catch (err) {
        processingRef.current = false;
        console.error("sendTranscript error:", err);
        // Speak the retry prompt (voice mode) OR surface a banner + toast (text
        // mode). The red "error" voice status is reserved for mic-permission-denied.
        if (textModeRef.current) {
          const friendly = "Something went wrong. Try again.";
          dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: friendly });
          toast.error(friendly, { duration: 3000 });
        } else {
          await voice.speak("Sorry, I didn't catch that. Try again.");
        }
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        if (isOpenRef.current && !textModeRef.current) {
          setTimeout(() => {
            if (isOpenRef.current && !textModeRef.current) void startListeningRef.current();
          }, 150);
        }
      }
    },
    [dispatch, orchestrator, voice, navigate, hasCard, vapi],
  );

  const startListening = useCallback(async () => {
    if (!isOpenRef.current) return;
    // On the Vapi path, the WebRTC call is already owning the mic +
    // listen-speak cycle — no manual relisten loop needed.
    if (VAPI_ENABLED && vapi.isAvailable) {
      if (!vapi.isActive()) await vapi.start();
      return;
    }
    try {
      const { transcript, stopped } = await voice.startListening();
      if (stopped) {
        emptyRelistenStreakRef.current = 0;
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (transcript.trim()) {
        emptyRelistenStreakRef.current = 0;
        await sendTranscript(transcript);
      } else if (isOpenRef.current && !textModeRef.current) {
        // Empty transcript → relisten, but ALWAYS via setTimeout and capped
        // at MAX_EMPTY_RELISTENS. A sync `void startListeningRef.current()`
        // recursion here starves the microtask queue and hangs the tab when
        // the recognizer repeatedly resolves without capturing audio.
        emptyRelistenStreakRef.current += 1;
        if (emptyRelistenStreakRef.current >= MAX_EMPTY_RELISTENS) {
          emptyRelistenStreakRef.current = 0;
          dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
          return;
        }
        setTimeout(() => {
          if (isOpenRef.current && !textModeRef.current) {
            void startListeningRef.current();
          }
        }, 400);
      }
    } catch (err) {
      // Transient errors (InvalidStateError, recognition-start-failed,
      // audio-capture hiccups) — retry once. "not-allowed" already flipped
      // voiceStatus to "error" in useCenaivaVoice; leave that UI alone so the
      // user sees the grant-access prompt and tapping it re-requests perms.
      const msg = (err as Error)?.message ?? "";
      const isPermDenied = msg === "not-allowed" || msg.includes("not-allowed");
      if (isPermDenied) return;
      emptyRelistenStreakRef.current += 1;
      if (emptyRelistenStreakRef.current >= MAX_EMPTY_RELISTENS) {
        emptyRelistenStreakRef.current = 0;
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (isOpenRef.current && !textModeRef.current) {
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        setTimeout(() => {
          if (isOpenRef.current && !textModeRef.current) {
            void startListeningRef.current();
          }
        }, 500);
      }
    }
  }, [voice, sendTranscript, dispatch, vapi]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const open = useCallback(
    (restaurantId?: string, restaurantName?: string) => {
      requestLocation();

      if (!micGrantedRef.current) {
        requestMicPermission().then((granted) => {
          if (granted) {
            micGrantedRef.current = true;
          }
        });
      }

      if (restaurantId && restaurantName) {
        dispatch({ type: "PRESELECT_RESTAURANT", restaurant_id: restaurantId, restaurant_name: restaurantName });
      } else {
        dispatch({ type: "OPEN" });
      }
    },
    [dispatch, requestLocation],
  );

  // voice is a fresh object literal every render of useCenaivaVoice, so any
  // callback that lists it as a dep would change identity every render. We
  // route through refs to give `close` a stable identity — otherwise the
  // paid-auto-close effect below would re-clear its own timeout every render
  // and never actually fire.
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  });

  // Same pattern for the Vapi hook — keeps `close` / `sayGoodbyeAndClose`
  // callback identities stable while still calling into the latest hook.
  const vapiRef = useRef(vapi);
  useEffect(() => {
    vapiRef.current = vapi;
  });

  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const close = useCallback(() => {
    isOpenRef.current = false;
    textModeRef.current = false;
    emptyRelistenStreakRef.current = 0;
    voiceRef.current.stopSpeaking();
    voiceRef.current.stopListening();
    if (VAPI_ENABLED) {
      void vapiRef.current.stop();
    }
    dispatch({ type: "CLOSE" });
    // Always return the user to the discovery page when the Cenaiva flow ends
    // (post-booking save, decline preorder, payment success, manual close).
    // navigate() is a no-op if they are already on /discover.
    if (pathnameRef.current !== "/discover") navigate("/discover");
  }, [dispatch, navigate]);

  const sayGoodbyeAndClose = useCallback(
    async (message = "Enjoy your meal. Bye!", redirectAfter?: string) => {
      // Stop the mic so the farewell actually plays without fighting the
      // recognizer for the audio stream.
      isOpenRef.current = false;
      textModeRef.current = false;
      emptyRelistenStreakRef.current = 0;
      voiceRef.current.stopListening();
      dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: message });
      try {
        await voiceRef.current.speak(message);
      } catch {
        // Speech can fail (autoplay policy, no voices) — we still close.
      }
      dispatch({ type: "CLOSE" });
      if (redirectAfter) {
        navigate(redirectAfter);
      } else if (pathnameRef.current !== "/discover") {
        navigate("/discover");
      }
    },
    [dispatch, navigate],
  );

  const setTextMode = useCallback((active: boolean) => {
    textModeRef.current = active;
  }, []);

  // After a successful payment the "You're all set!" confirmation renders
  // briefly. We speak a short farewell, then tear down the shell and navigate
  // back to /discover so the user isn't stranded on a paid receipt.
  const paidAckRef = useRef(false);
  useEffect(() => {
    if (state.booking.status !== "paid") {
      paidAckRef.current = false;
      return;
    }
    if (paidAckRef.current) return;
    paidAckRef.current = true;
    const t = setTimeout(() => {
      void sayGoodbyeAndClose("You're all set. Enjoy your meal. Bye!");
    }, 1500);
    return () => clearTimeout(t);
  }, [state.booking.status, sayGoodbyeAndClose]);

  const onWake = useCallback(() => {
    if (!user) return;
    // Prime the audio pipeline again on wake so the greeting reliably plays.
    try { voice.primeTTS(); } catch { /* noop */ }
    open();
  }, [user, open, voice]);

  const { setEnabled: setWakeWordEnabled, forceStop: forceStopWakeWord } =
    useCenaivaWakeWord(onWake);

  const enableWakeWord = useCallback(() => {
    if (micGrantedRef.current) setWakeWordEnabled(true);
  }, [setWakeWordEnabled]);

  useEffect(() => {
    if (!isCustomerRoute) return;
    checkMicPermission().then((state) => {
      if (state === "granted") {
        micGrantedRef.current = true;
        setWakeWordEnabled(true);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCustomerRoute]);

  useEffect(() => {
    // Off-route: hard-stop the recognizer so the mic stream is released on
    // /login, /dashboard, etc. This is the single biggest idle-memory win.
    if (!isCustomerRoute) {
      forceStopWakeWord();
      return;
    }
    if (state.isOpen) {
      forceStopWakeWord();
    } else {
      const t = setTimeout(() => enableWakeWord(), 500);
      return () => clearTimeout(t);
    }
  }, [isCustomerRoute, state.isOpen, forceStopWakeWord, enableWakeWord]);

  // Memoize the context value so every consumer of useAssistant() doesn't
  // re-render on every state dispatch. Without this, the shell, rail, map,
  // and booking sheet all re-run on every tick of speech status / spoken
  // text / booking delta — the biggest contributor to the collecting_minimum_fields
  // render storm that was triggering "Page Unresponsive".
  const ctx = useMemo<AssistantContextValue>(
    () => ({ open, close, sayGoodbyeAndClose, sendTranscript, startListening, setTextMode }),
    [open, close, sayGoodbyeAndClose, sendTranscript, startListening, setTextMode],
  );
  return <AssistantCtx.Provider value={ctx}>{children}</AssistantCtx.Provider>;
}

// ── Public wrapper ────────────────────────────────────────────────────────────

export function AssistantProvider({ children }: { children: ReactNode }) {
  return (
    <AssistantStoreProvider>
      <AssistantInner>{children}</AssistantInner>
    </AssistantStoreProvider>
  );
}

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useCenaivaOrchestrator } from "@/hooks/useCenaivaOrchestrator";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { useCenaivaWakeWord } from "@/hooks/useCenaivaWakeWord";
import { useAssistantStore, AssistantStoreProvider } from "@/components/cenaiva/AssistantStore";
import { useUser } from "@/hooks/useUser";
import { useSavedCards } from "@/hooks/useSavedCards";
import type { OrchestratorRequestType } from "@cenaiva/assistant";

// ── Context exposed to child components ───────────────────────────────────────

interface AssistantContextValue {
  open: (restaurantId?: string, restaurantName?: string) => void;
  close: () => void;
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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const processingRef = useRef(false);
  const micGrantedRef = useRef(false);
  const isOpenRef = useRef(false);
  const textModeRef = useRef(false);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});

  // Sync hasCard into booking state so components and orchestrator requests can use it
  useEffect(() => {
    dispatch({ type: "SET_HAS_SAVED_CARD", value: hasCard });
  }, [hasCard, dispatch]);

  useEffect(() => {
    isOpenRef.current = state.isOpen;
  }, [state.isOpen]);

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
      processingRef.current = true;

      dispatch({ type: "SET_VOICE_STATUS", status: "processing" });

      const req: OrchestratorRequestType = {
        transcript,
        screen: "discover",
        booking_state: {
          restaurant_id: state.booking.restaurant_id,
          party_size: state.booking.party_size,
          date: state.booking.date,
          time: state.booking.time,
          shift_id: state.booking.shift_id,
          slot_iso: state.booking.slot_iso,
          status: state.booking.status,
          confirmation_code: state.booking.confirmation_code,
          reservation_id: state.booking.reservation_id,
          order_id: state.booking.order_id,
          tip_choice: state.booking.tip_choice,
          tip_amount: state.booking.tip_amount,
          tip_percent: state.booking.tip_percent,
          payment_split: state.booking.payment_split,
          payment_status: state.booking.payment_status,
          cart_subtotal: state.booking.cart_subtotal,
          cart: state.booking.cart,
        },
        map_state: {
          visible: state.map.visible,
          center: state.map.center,
          zoom: state.map.zoom,
          marker_restaurant_ids: state.map.marker_restaurant_ids,
        },
        filters: state.filters,
        visible_restaurant_ids: state.map.marker_restaurant_ids,
        selected_restaurant_id: opts?.restaurantId ?? state.booking.restaurant_id,
        user_location: userLocationRef.current,
        conversation_id: state.conversationId ?? undefined,
        has_saved_card: hasCard,
        guest_id: null,
        reservation_id: state.booking.reservation_id,
      };

      try {
        const response = await orchestrator.send(req);
        processingRef.current = false;

        if (!response) {
          dispatch({ type: "SET_VOICE_STATUS", status: "error" });
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

        if (response.spoken_text) await voice.speak(response.spoken_text);
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });

        if (isOpenRef.current && !textModeRef.current) {
          setTimeout(() => {
            if (isOpenRef.current && !textModeRef.current) {
              void startListeningRef.current();
            }
          }, 200);
        }
      } catch (err) {
        processingRef.current = false;
        console.error("sendTranscript error:", err);
        dispatch({ type: "SET_VOICE_STATUS", status: "error" });
      }
    },
    [state, dispatch, orchestrator, voice, navigate, hasCard],
  );

  const startListening = useCallback(async () => {
    if (!isOpenRef.current) return;
    try {
      const { transcript, stopped } = await voice.startListening();
      if (stopped) {
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (transcript.trim()) {
        await sendTranscript(transcript);
      } else if (isOpenRef.current && !textModeRef.current) {
        void startListeningRef.current();
      }
    } catch {
      // Recognition threw a fatal error (e.g. "not-allowed").
      // Reset to idle and retry once after a short delay — if it was a transient
      // audio-capture hiccup the retry succeeds; if the mic is truly denied the
      // user will see the grant-access prompt on the next attempt.
      if (isOpenRef.current && !textModeRef.current) {
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        setTimeout(() => {
          if (isOpenRef.current && !textModeRef.current) {
            void startListeningRef.current();
          }
        }, 500);
      }
    }
  }, [voice, sendTranscript, dispatch]);

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

  const close = useCallback(() => {
    isOpenRef.current = false;
    textModeRef.current = false;
    voice.stopSpeaking();
    voice.stopListening();
    dispatch({ type: "CLOSE" });
  }, [dispatch, voice]);

  const setTextMode = useCallback((active: boolean) => {
    textModeRef.current = active;
  }, []);

  const onWake = useCallback(() => {
    if (!user) return;
    open();
  }, [user, open]);

  const { setEnabled: setWakeWordEnabled, forceStop: forceStopWakeWord } =
    useCenaivaWakeWord(onWake);

  const enableWakeWord = useCallback(() => {
    if (micGrantedRef.current) setWakeWordEnabled(true);
  }, [setWakeWordEnabled]);

  useEffect(() => {
    if (!user) return;
    checkMicPermission().then((state) => {
      if (state === "granted") {
        micGrantedRef.current = true;
        setWakeWordEnabled(true);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  useEffect(() => {
    if (state.isOpen) {
      forceStopWakeWord();
    } else if (user) {
      const t = setTimeout(() => enableWakeWord(), 500);
      return () => clearTimeout(t);
    }
  }, [state.isOpen, user, forceStopWakeWord, enableWakeWord]);

  const ctx: AssistantContextValue = { open, close, sendTranscript, startListening, setTextMode };
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

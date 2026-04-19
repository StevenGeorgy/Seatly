import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { useCenaivaOrchestrator } from "@/hooks/useCenaivaOrchestrator";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { useCenaivaWakeWord } from "@/hooks/useCenaivaWakeWord";
import { useAssistantStore, AssistantStoreProvider } from "@/components/cenaiva/AssistantStore";
import { useUser } from "@/hooks/useUser";
import type { OrchestratorRequestType } from "@cenaiva/assistant";

// ── Context exposed to child components ───────────────────────────────────────

interface AssistantContextValue {
  open: (restaurantId?: string, restaurantName?: string) => void;
  close: () => void;
  sendTranscript: (transcript: string) => Promise<void>;
  startListening: () => Promise<void>;
}

const AssistantCtx = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue | null {
  return useContext(AssistantCtx);
}

// ── Inner provider (needs AssistantStore in tree) ─────────────────────────────

function AssistantInner({ children }: { children: ReactNode }) {
  const { state, dispatch } = useAssistantStore();
  const { user } = useUser();
  const orchestrator = useCenaivaOrchestrator();
  const voice = useCenaivaVoice();
  const navigate = useNavigate();

  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const processingRef = useRef(false);

  // Silent geolocation — only fetches if the user has already granted permission.
  // Never triggers the browser permission dialog unexpectedly.
  const requestLocation = useCallback(() => {
    if (userLocationRef.current || !navigator.geolocation) return;
    if (!navigator.permissions) {
      // Permissions API unavailable — skip rather than surprise the user.
      return;
    }
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (result.state === "granted") {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              userLocationRef.current = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            },
            () => {},
            { timeout: 5000, maximumAge: 60_000 },
          );
        }
        // "prompt" or "denied" → do nothing; orchestrator works fine without location.
      })
      .catch(() => {});
  }, []);

  const sendTranscript = useCallback(
    async (transcript: string) => {
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
        },
        map_state: {
          visible: state.map.visible,
          center: state.map.center,
          zoom: state.map.zoom,
          marker_restaurant_ids: state.map.marker_restaurant_ids,
        },
        filters: state.filters,
        visible_restaurant_ids: state.map.marker_restaurant_ids,
        selected_restaurant_id: state.booking.restaurant_id,
        user_location: userLocationRef.current,
        conversation_id: state.conversationId ?? undefined,
      };

      const response = await orchestrator.send(req);
      processingRef.current = false;

      if (!response) {
        dispatch({ type: "SET_VOICE_STATUS", status: "error" });
        return;
      }

      // Apply the full response (deltas + ui_actions) to the store
      dispatch({ type: "APPLY_RESPONSE", response });

      // Handle side-effects from ui_actions that need imperative calls
      for (const action of response.ui_actions) {
        if (action.type === "toast") {
          toast(action.message, { duration: 3000 });
        }
        if (action.type === "navigate") {
          navigate(action.path);
        }
      }

      // Speak the response
      if (response.spoken_text) {
        await voice.speak(response.spoken_text);
      }

      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    },
    [state, dispatch, orchestrator, voice, navigate],
  );

  const startListening = useCallback(async () => {
    const transcript = await voice.startListening();
    if (transcript.trim()) {
      await sendTranscript(transcript);
    } else {
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    }
  }, [voice, sendTranscript, dispatch]);

  const open = useCallback(
    (restaurantId?: string, restaurantName?: string) => {
      requestLocation();
      if (restaurantId && restaurantName) {
        dispatch({ type: "PRESELECT_RESTAURANT", restaurant_id: restaurantId, restaurant_name: restaurantName });
      } else {
        dispatch({ type: "OPEN" });
      }
    },
    [dispatch, requestLocation],
  );

  const close = useCallback(() => {
    voice.stopSpeaking();
    voice.stopListening();
    dispatch({ type: "CLOSE" });
  }, [dispatch, voice]);

  // Wake word → open + start listening.
  // Delay startListening by 350 ms so Chrome's previous recognizer fully tears
  // down before we start a new one (Chrome only allows one active at a time).
  const onWake = useCallback(() => {
    if (!user) return;
    open();
    setTimeout(() => void startListening(), 350);
  }, [user, open, startListening]);

  const { toggle: toggleWakeWord, setEnabled: setWakeWordEnabled, forceStop: forceStopWakeWord } =
    useCenaivaWakeWord(onWake);

  // Auto-enable wake word once on login
  useEffect(() => {
    if (user) toggleWakeWord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!user]);

  // Stop wake word while shell is open (prevents mic conflict with command recognizer).
  // Restart it 500 ms after shell closes so Chrome's recognizer slot is free.
  useEffect(() => {
    if (state.isOpen) {
      forceStopWakeWord();
    } else if (user) {
      const t = setTimeout(() => setWakeWordEnabled(true), 500);
      return () => clearTimeout(t);
    }
  }, [state.isOpen, user, forceStopWakeWord, setWakeWordEnabled]);

  const ctx: AssistantContextValue = { open, close, sendTranscript, startListening };

  return <AssistantCtx.Provider value={ctx}>{children}</AssistantCtx.Provider>;
}

// ── Public wrapper — mounts the store then the inner layer ────────────────────

export function AssistantProvider({ children }: { children: ReactNode }) {
  return (
    <AssistantStoreProvider>
      <AssistantInner>{children}</AssistantInner>
    </AssistantStoreProvider>
  );
}

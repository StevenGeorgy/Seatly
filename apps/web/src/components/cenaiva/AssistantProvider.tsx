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
  const orchestrator = useCenaivaOrchestrator();
  const voice = useCenaivaVoice();
  const navigate = useNavigate();

  const userLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const processingRef = useRef(false);
  const micGrantedRef = useRef(false);
  const isOpenRef = useRef(false);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    isOpenRef.current = state.isOpen;
  }, [state.isOpen]);

  // Silent geolocation — only fetches if already granted, never prompts.
  const requestLocation = useCallback(() => {
    if (userLocationRef.current || !navigator.geolocation) return;
    navigator.permissions
      ?.query({ name: "geolocation" as PermissionName })
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

      dispatch({ type: "APPLY_RESPONSE", response });

      for (const action of response.ui_actions) {
        if (action.type === "toast") toast(action.message, { duration: 3000 });
        if (action.type === "navigate") navigate(action.path);
      }

      if (response.spoken_text) await voice.speak(response.spoken_text);
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });

      // Auto-listen after AI speaks — keeps the conversation hands-free
      if (isOpenRef.current) {
        void startListeningRef.current();
      }
    },
    [state, dispatch, orchestrator, voice, navigate],
  );

  const startListening = useCallback(async () => {
    try {
      const { transcript, stopped } = await voice.startListening();
      if (stopped) {
        // User explicitly tapped stop — break the auto-listen loop
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (transcript.trim()) {
        await sendTranscript(transcript);
        // sendTranscript auto-listens at end; nothing more to do here
      } else if (isOpenRef.current) {
        // Silence / no-speech — keep listening
        void startListeningRef.current();
      }
    } catch {
      // Mic error — voice status already set to "error" by useCenaivaVoice
    }
  }, [voice, sendTranscript, dispatch]);

  // Keep ref current so sendTranscript can call startListening without circular dep
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const open = useCallback(
    (restaurantId?: string, restaurantName?: string) => {
      requestLocation();

      // Request mic in user-gesture context (button click) so Chrome shows
      // a clear, expected dialog — not a background surprise on page load.
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
    isOpenRef.current = false; // synchronously kill auto-listen loop before dispatch
    voice.stopSpeaking();
    voice.stopListening();
    dispatch({ type: "CLOSE" });
  }, [dispatch, voice]);

  // Wake word → open the shell only. Voice input is manual (tap the orb).
  const onWake = useCallback(() => {
    if (!user) return;
    open();
  }, [user, open]);

  const { setEnabled: setWakeWordEnabled, forceStop: forceStopWakeWord } =
    useCenaivaWakeWord(onWake);

  // Enable the wake word listener. Only starts if mic is already permitted.
  const enableWakeWord = useCallback(() => {
    if (micGrantedRef.current) setWakeWordEnabled(true);
  }, [setWakeWordEnabled]);

  // On mount: if mic is already granted (returning visitor), auto-start wake word.
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

  // Stop wake word while shell is open (prevents mic conflict with command recognizer).
  // Restart 500 ms after shell closes so Chrome's recognizer slot is free.
  useEffect(() => {
    if (state.isOpen) {
      forceStopWakeWord();
    } else if (user) {
      const t = setTimeout(() => enableWakeWord(), 500);
      return () => clearTimeout(t);
    }
  }, [state.isOpen, user, forceStopWakeWord, enableWakeWord]);

  const ctx: AssistantContextValue = { open, close, sendTranscript, startListening };
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

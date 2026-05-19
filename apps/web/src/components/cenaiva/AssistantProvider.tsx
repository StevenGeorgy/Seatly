import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { useErrorToast } from "@/lib/errors";
import { useCenaivaOrchestrator } from "@/hooks/useCenaivaOrchestrator";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { useCenaivaWakeWord } from "@/hooks/useCenaivaWakeWord";
import { useCenaivaLatencyBudget, type LatencyTransport } from "@/hooks/useCenaivaLatencyBudget";
import { NOISE_ROBUST_AUDIO_CONSTRAINTS, prefetchDeepgramToken } from "@/hooks/useDeepgramTranscription";
import { useAssistantStore, AssistantStoreProvider } from "@/components/cenaiva/AssistantStore";
import {
  NO_AUTO_RELISTEN_STATUSES,
} from "@/components/cenaiva/assistantStoreConstants";
import { useUser } from "@/hooks/useUser";
import { useSavedCards } from "@/hooks/useSavedCards";
import { buildWakeGreeting } from "@/lib/cenaiva/buildWakeGreeting";
import { transcriptForCenaivaBookingConfirmation } from "@/lib/cenaiva/confirmationIntent";
import {
  getCenaivaRecommendationMode,
  normalizeSingleRestaurantRecommendationResponse,
  applyClientDiscoveryMemory,
} from "@/lib/cenaiva/recommendationIntent";
import type { OrchestratorRequestType } from "@cenaiva/assistant";

// ── Context exposed to child components ───────────────────────────────────────

interface AssistantContextValue {
  open: (
    restaurantId?: string,
    restaurantName?: string,
    opts?: { autoListen?: boolean; greetingText?: string },
  ) => void;
  close: () => void;
  /**
   * Speak a farewell line, then tear down the voice stack and navigate.
   * Defaults to /discover when not already there. Pass `redirectAfter` to
   * land elsewhere (e.g. public menu after accepting pre-order).
   */
  sayGoodbyeAndClose: (message?: string, redirectAfter?: string) => Promise<void>;
  sendTranscript: (
    transcript: string,
    opts?: { restaurantId?: string; silent?: boolean; force?: boolean; alternatives?: string[] },
  ) => Promise<void>;
  startListening: () => Promise<void>;
  shouldAutoListenOnOpen: () => boolean;
  setSpeechHints: (hints: string[]) => void;
  setTextMode: (active: boolean) => void;
  /**
   * True when `open()` was called with `greetingText` (wake-word path), so
   * the wake-greeting flow at open() is already handling TTS playback.
   * CenaivaVoiceShell's local greeting effect checks this to avoid a
   * double-greeting (one from the provider's wake flow, one from the
   * shell's own opener). Returns false on UI-tap opens where the shell
   * should speak its own greeting.
   */
  wasGreetingHandledExternally: () => boolean;
  /**
   * True once the greeting TTS has played at least once in this browser
   * session (across rapid open/close cycles). Reset on logout. Used by
   * CenaivaVoiceShell to stop firing duplicate "Good morning..." TTS
   * attempts when the user opens/closes/reopens Cenaiva rapidly.
   */
  wasSessionGreetingPlayed: () => boolean;
  markSessionGreetingPlayed: () => void;
  /**
   * True while an orchestrator turn is in flight. Mirrors processingRef so
   * Send button / Enter handler can disable visibly between Stages 1–4 of
   * sendTranscript. Without this, second clicks during in-flight turns were
   * silently dropped by the processingRef guard.
   */
  isProcessing: boolean;
}

const AssistantCtx = createContext<AssistantContextValue | null>(null);
const RELISTEN_AFTER_EMPTY_TURN_MS = 100;
const RELISTEN_AFTER_ERROR_MS = 150;
// Auto-close the assistant after this long with no user input + no AI
// activity. Catches the case where the user opens the assistant, walks
// away (or wakes-word false-positive fires onto a still-open assistant),
// and the mic keeps burning Deepgram quota for hours. Reset on every
// transcript send, every AI response, every drawer click.
const IDLE_AUTO_CLOSE_MS = 120_000;
// Suppress repeat wake-word fires within this window. The wake recognizer
// occasionally bursts multiple onWake calls from fuzzy phrase matches
// ("hey sanibel" / "hey soniva" / etc.) — without a debounce each call
// re-runs the open-greeting flow. 1.2 s is enough to swallow burst-fires
// (which arrive within ~300 ms of each other) while still letting a user
// say "Hey Cenaiva" twice in a row to retry a missed wake.
const WAKE_DEBOUNCE_MS = 1_200;

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
  // Note: voicePref hook removed from this component after 2026-05-16
  // single-orchestrator collapse. /account/voice and useCenaivaVoice still
  // call useCenaivaVoicePreference directly.
  const latency = useCenaivaLatencyBudget();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { errorToast } = useErrorToast();

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
  // B1 (2026-05-17): mirror processingRef into reactive state so the Send
  // button + Enter handler can show a disabled state while a turn is in
  // flight. Without this mirror, second/third clicks during an in-flight
  // orchestrator call were silently dropped by the processingRef guard.
  const [isProcessing, setIsProcessing] = useState(false);
  const setProcessing = useCallback((value: boolean) => {
    processingRef.current = value;
    setIsProcessing(value);
  }, []);
  const micGrantedRef = useRef(false);
  const isOpenRef = useRef(false);
  const textModeRef = useRef(false);
  // Mirror voice.isMuted into a ref so the auto-resume timer (set inside
  // setTimeout callbacks) reads the latest mute state, not the value captured
  // when the timer was scheduled.
  const muteRef = useRef(false);
  const startListeningRef = useRef<() => Promise<void>>(async () => {});
  // Forward-reference: sayGoodbyeAndClose is declared further down in this
  // component, but sendTranscript (declared earlier) needs to invoke it when
  // the orchestrator emits a `close_assistant` ui_action. Bridge via a ref.
  const sayGoodbyeAndCloseRef = useRef<
    (message?: string, redirectAfter?: string) => Promise<void>
  >(async () => {});
  const speechHintsRef = useRef<string[]>([]);
  const autoListenOnOpenRef = useRef(false);
  const turnIdRef = useRef(0);
  // Greeting text passed to open() — spoken after audio context unlocks.
  const greetingTextRef = useRef<string | null>(null);
  // The wake-word recognizer and the command recognizer cannot BOTH hold the
  // mic on Chrome — only one active SpeechRecognition instance is allowed.
  // When we open the shell we must synchronously tear down the wake-word
  // recognizer before starting the command recognizer. React's effect-based
  // teardown runs *after* commit, which is too late and causes InvalidStateError.
  const forceStopWakeWordRef = useRef<() => void>(() => {});
  // Idle auto-close + wake debounce refs. The idle timer is reset on
  // every activity (sendTranscript, AI response, user interaction); when
  // it fires, the assistant gracefully closes if nothing's in flight.
  const idleCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWakeFireMsRef = useRef(0);
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
  // Set to 20 (≈100s of patient mic-on after AI response if user is
  // silent). Originally 3, briefly 1 on 2026-05-11 evening — that was
  // too aggressive: 5s of think-time is short and the user kept getting
  // their mic closed mid-thought. The IDLE_AUTO_CLOSE_MS timer (120s) is
  // the real "user gave up" signal; this cap is just a safety net so a
  // stuck recognizer can't loop forever.
  // 3 empty turns in a row → surface an honest "didn't catch that" prompt
  // instead of silent-looping for ~30 s. Combined with the 15 s no-speech
  // window in useDeepgramTranscription, that's ~45 s of patience before
  // we admit we missed it — well past anyone's natural attention span on
  // a single utterance.
  const MAX_EMPTY_RELISTENS = 3;

  // Sync hasCard into booking state so components and orchestrator requests can use it
  useEffect(() => {
    dispatch({ type: "SET_HAS_SAVED_CARD", value: hasCard });
  }, [hasCard, dispatch]);

  useEffect(() => {
    isOpenRef.current = state.isOpen;
  }, [state.isOpen]);

  // Sync voice.isMuted into the ref. Renders happen on toggle, and the
  // setTimeout auto-resume reads via the ref.
  useEffect(() => {
    muteRef.current = voice.isMuted;
  }, [voice.isMuted]);

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
    async (
      transcript: string,
      opts?: { restaurantId?: string; silent?: boolean; force?: boolean; alternatives?: string[] },
    ) => {
      // Phase 4 (input validation rollout): client-side transcript cap.
      // Matches the server-side cap in cenaiva-orchestrate (5000 chars).
      // Truncate rather than reject so a runaway STT stream doesn't kill
      // the conversation — the user's intent is in the first ~50 words
      // anyway.
      if (transcript.length > 5000) {
        transcript = transcript.slice(0, 5000);
      }

      const turnId = ++turnIdRef.current;
      latency.start(turnId);
      latency.mark(turnId, "transcriptAt");

      if (processingRef.current) {
        if (!opts?.force) return;
        orchestrator.cancel();
        setProcessing(false);
      }
      setProcessing(true);

      // Hard-stop any active recognition before processing. This must happen on
      // THIS voice hook instance (the same one that started the recognizer) —
      // calling voice.stopListening() from child components targets a different
      // per-hook ref and leaves Chrome's SpeechRecognition running, which then
      // wedges the next listen cycle after the orchestrator replies.
      voice.stopListening();

      dispatch({ type: "SET_VOICE_STATUS", status: "processing" });

      const current = stateRef.current;
      // Confirmation rewrite: when the orchestrator just asked for booking
      // confirmation and the user says a bare "yes", rewrite to a fuller
      // phrase so the orchestrator's confirmation handler routes correctly
      // even without prior-turn intent inference.
      const orchestratorTranscript = transcriptForCenaivaBookingConfirmation(
        current.booking.status,
        transcript,
      );
      const recommendationMode = getCenaivaRecommendationMode(transcript);
      const browserTimeZone =
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;

      // ── SINGLE ORCHESTRATOR CALL ──────────────────────────────────────────
      // 2026-05-16: collapsed the prior 4-stage pipeline (local booking
      // collector + availability check + small-prompt + orchestrator) into a
      // single orchestrator call. The orchestrator now owns slot extraction,
      // availability checks (as a tool), fact lookups (via get_restaurant_snapshot),
      // modify/cancel routing, and off-topic redirects. See CENAIVA_REBUILD_PLAN.md.
      // Forward Deepgram's runner-up transcripts so the orchestrator can
      // score each candidate against the visible/active restaurant list and
      // pick the best fit. Only forwarded when the rewriter did NOT change
      // the transcript (yes-confirmation rewrites are exact, not fuzzy).
      const forwardedAlternatives =
        opts?.alternatives && opts.alternatives.length > 0 && orchestratorTranscript === transcript
          ? opts.alternatives.filter((a) => a && a !== orchestratorTranscript).slice(0, 3)
          : undefined;

      const req: OrchestratorRequestType = {
        transcript: orchestratorTranscript,
        transcript_alternatives: forwardedAlternatives,
        screen: "discover",
        booking_state: {
          restaurant_id: current.booking.restaurant_id,
          restaurant_name: current.booking.restaurant_name,
          party_size: current.booking.party_size,
          date: current.booking.date,
          time: current.booking.time,
          shift_id: current.booking.shift_id,
          slot_iso: current.booking.slot_iso,
          special_request: current.booking.special_request,
          occasion: current.booking.occasion,
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
          pending_action: current.booking.pending_action,
          // Forward event/promo auto-attach context so multi-turn flows
          // (e.g. "any events at X" → "book it for 2") see the candidates
          // stashed by the prior orchestrator turn.
          offered_events: current.booking.offered_events,
          offered_promotion: current.booking.offered_promotion,
          // Forward multi-turn modify scratch so turn 2 of "change my
          // reservation to 8pm" → "thursday at 8pm" sees the prior turn's
          // partial fields. Without this, isContinuingModify on the
          // orchestrator side stays false and the standard booking-
          // collection flow hijacks the follow-up turn. 2026-05-13 fix.
          modify_date: current.booking.modify_date,
          modify_time: current.booking.modify_time,
          modify_party: current.booking.modify_party,
          // Forward disambig context — set by orchestrator when multi-active
          // modify/cancel needs the user to pick one. Without this, the next
          // turn's reply ("the saturday one", "harbour sixty") loses context.
          pending_modify_disambig: (current.booking as unknown as Record<string, unknown>).pending_modify_disambig ?? null,
        } as OrchestratorRequestType["booking_state"],
        map_state: {
          visible: current.map.visible,
          center: current.map.center,
          zoom: current.map.zoom,
          marker_restaurant_ids: current.map.marker_restaurant_ids,
        },
        filters: current.filters,
        visible_restaurant_ids: current.map.marker_restaurant_ids,
        selected_restaurant_id: opts?.restaurantId ?? current.booking.restaurant_id,
        recommendation_mode: recommendationMode ?? undefined,
        assistant_memory: current.memory,
        user_location: userLocationRef.current,
        timezone: browserTimeZone || undefined,
        conversation_id: current.conversationId ?? undefined,
        has_saved_card: hasCard,
        guest_id: null,
        reservation_id: current.booking.reservation_id,
      };

      latency.mark(turnId, "requestSentAt");

      // Capture what the orchestrator streamed via speech_chunk SSE frames.
      // After the final payload arrives we compare this to spoken_text — if
      // they match we skip the trailing voice.speak() (avoiding a double-
      // speak), otherwise we discard the queued audio and speak the override.
      let streamedText = "";
      let firstChunkSeen = false;
      const streamingActive = voice.isStreamingTTSAvailable && !opts?.silent;
      const streamCallbacks = streamingActive
        ? {
            onSpeechChunk: (text: string) => {
              if (!firstChunkSeen) {
                latency.mark(turnId, "firstSpeechChunkAt");
                firstChunkSeen = true;
              }
              streamedText += (streamedText ? " " : "") + text;
              voice.speakStreamingChunk(text);
            },
            onDiscardPendingSpeech: () => {
              streamedText = "";
              voice.discardStreamingSpeech();
            },
            onTransport: (t: LatencyTransport) => latency.markTransport(turnId, t),
          }
        : undefined;

      try {
        const rawResponse = await orchestrator.send(req, streamCallbacks);
        latency.mark(turnId, "finalReceivedAt");
        // R10 (2026-05-17): keep processingRef TRUE through TTS playback.
        // Previously setProcessing(false) fired right after orchestrator
        // returned, so user speaking during TTS triggered a new sendTranscript
        // that cancelled the in-flight TTS — Cenaiva went silent. Now
        // processingRef stays true until TTS drains, so mid-TTS STT events
        // get dropped at the processingRef guard in sendTranscript.
        // The final setProcessing(false) now lives just before the auto-relisten
        // call below.

        if (!rawResponse) {
          // Orchestrator returned null (network / timeout / 500). Handle text
          // mode and voice mode differently: chat users can see a banner + toast,
          // voice users need an audible retry cue. Discard any partially-
          // queued streaming audio so the user doesn't hear half a sentence.
          if (streamingActive) voice.discardStreamingSpeech();
          const cause = orchestrator.lastErrorRef.current ?? "unknown";
          // Surface specific failure modes when we can. Generic "something went
          // wrong" is a last resort — the cause string carries enough signal
          // to give the user a better hint in most cases.
          const isRateLimited =
            cause.includes("rate_limit") ||
            cause.includes("429") ||
            cause.toLowerCase().includes("too many requests");
          const isOverloaded =
            cause.toLowerCase().includes("overload") ||
            cause.toLowerCase().includes("busy") ||
            cause.includes("503");
          const isSchemaDrift = cause.startsWith("schema_drift");
          const isNoFinal = cause === "no_final_payload";
          const friendly =
            cause === "timeout"
              ? "The assistant is taking a while. Try again."
              : cause === "not_authenticated"
                ? "Please sign in again to continue."
                : isRateLimited
                  ? "Cenaiva is busy right now. Try again in a moment."
                  : isOverloaded
                    ? "The voice service is overloaded. Try again in a moment."
                    : isNoFinal
                      ? "The assistant didn't finish responding. Try again."
                      : isSchemaDrift
                        ? "Something went wrong on our end — please rephrase and try again."
                        : "Something went wrong. Try again.";
          // Always log the raw cause so future debugging is easy. This is the
          // most informative signal we have on what the orchestrator actually
          // returned (timeout / schema_drift / http_503 / claude_overload / …).
          console.warn(
            "[Cenaiva.orchestrator] turn failed — cause:",
            cause,
            "friendly:",
            friendly,
          );
          // Option A (2026-05-18): text-mode users get voice responses too.
          // Always speak the friendly error AND surface it in the caption /
          // toast so type-to-talk feels like a real assistant rather than
          // silent on errors.
          dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: friendly });
          if (textModeRef.current) {
            errorToast(cause, { fallback: friendly, duration: 3000, logTag: "[Cenaiva.orchestrator]" });
          }
          await voice.speak(friendly);
          dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
          if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
            setTimeout(() => {
              if (isOpenRef.current && !textModeRef.current && !muteRef.current) void startListeningRef.current();
            }, RELISTEN_AFTER_ERROR_MS);
          }
          latency.summarize(turnId);
          return;
        }

        // Apply recommendation-mode capping (single → one card + "I'd go with X")
        // and discovery memory (anti-repeat for "other restaurants" follow-ups).
        const cappedResponse =
          recommendationMode === "single"
            ? normalizeSingleRestaurantRecommendationResponse(rawResponse, transcript)
            : rawResponse;
        const response = applyClientDiscoveryMemory(cappedResponse, transcript, {
          rawResponse,
          previousMemory: current.memory,
          recommendationMode,
        });

        dispatch({ type: "APPLY_RESPONSE", response });

        // Scan ui_actions: collect navigate target + detect close_assistant.
        // close_assistant triggers a graceful sayGoodbyeAndClose AFTER the
        // spoken_text plays, with the captured navigate path (if any) as the
        // post-close redirect. The other handlers (toast, navigate_to_checkout)
        // run inline as before.
        let pendingClose = false;
        let pendingNavigatePath: string | null = null;
        for (const action of (response.ui_actions ?? [])) {
          if (!action || typeof action.type !== "string") continue;
          if (action.type === "toast") toast(action.message, { duration: 3000 });
          if (action.type === "navigate") {
            // If close_assistant is also queued, defer the navigate to the
            // sayGoodbyeAndClose redirect so the goodbye plays cleanly.
            const otherActions = response.ui_actions ?? [];
            const hasClose = otherActions.some(
              (a) => (a as { type?: string } | null)?.type === "close_assistant",
            );
            if (hasClose) {
              pendingNavigatePath = action.path;
            } else {
              navigate(action.path);
            }
          }
          if (action.type === "navigate_to_checkout") {
            isOpenRef.current = false;
            voice.stopSpeaking();
            voice.stopListening();
            dispatch({ type: "CLOSE" });
            navigate(action.path);
          }
          if (action.type === "close_assistant") {
            pendingClose = true;
          }
        }

        const spokenText = response.spoken_text ?? "";

        latency.mark(turnId, "playbackRequestedAt");

        // close_assistant from the orchestrator: speak the orchestrator's
        // farewell as the goodbye message and tear down the shell. Skips the
        // normal speak path (sayGoodbyeAndClose plays + closes + redirects).
        if (pendingClose) {
          if (streamingActive) voice.discardStreamingSpeech();
          await sayGoodbyeAndCloseRef.current(spokenText || undefined, pendingNavigatePath ?? undefined);
          setProcessing(false);
          latency.summarize(turnId);
          return;
        }

        if (spokenText && !opts?.silent) {
          // Normalize for comparison — strip trailing punctuation/whitespace
          // and collapse internal whitespace so minor formatting differences
          // (e.g. extra space after a period) don't trigger a double-speak.
          const norm = (s: string) =>
            s.replace(/\s+/g, " ").replace(/[.!?,\s]+$/, "").trim().toLowerCase();
          const streamedTextNorm = norm(streamedText);
          const spokenTextNorm = norm(spokenText);
          if (streamingActive && streamedTextNorm && streamedTextNorm === spokenTextNorm) {
            // Streamed text exactly matched the final spoken_text — just wait
            // for queued chunks to finish playing instead of re-speaking.
            await voice.drainStreamingSpeech();
          } else {
            // Override fired (auto-book confirmation, restaurant-selected
            // hard-prompt, anti-repetition rewrite) OR streaming was unavailable.
            // Drop any queued audio and speak the authoritative final text.
            if (streamingActive) voice.discardStreamingSpeech();
            await voice.speak(spokenText);
          }
        } else if (streamingActive) {
          // No spokenText (silent flow) — make sure any queued audio is dropped.
          voice.discardStreamingSpeech();
        }

        // R10 (2026-05-17): TTS finished — NOW it's safe to release the
        // processing guard. Mid-TTS STT events were dropped at the
        // processingRef guard, preventing the silent-failure cascade.
        setProcessing(false);

        // Auto-resume the mic UNLESS: assistant closed, user typing,
        // user manually muted, OR status is in the (now narrow) gated set.
        const next = stateRef.current;
        if (
          isOpenRef.current &&
          !textModeRef.current &&
          !muteRef.current &&
          !NO_AUTO_RELISTEN_STATUSES.has(next.booking.status)
        ) {
          if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
            void startListeningRef.current();
          }
        } else {
          dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        }
        latency.summarize(turnId);
      } catch (err) {
        setProcessing(false);
        if (streamingActive) voice.discardStreamingSpeech();
        // Option A (2026-05-18): speak the retry prompt in both voice and
        // text mode. Text mode also gets the inline toast/caption. The red
        // "error" voice status is reserved for mic-permission-denied.
        const friendly = textModeRef.current
          ? "Something went wrong. Try again."
          : "Sorry, I didn't catch that. Try again.";
        dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: friendly });
        if (textModeRef.current) {
          errorToast(err, { fallback: friendly, duration: 3000, logTag: "[Cenaiva.send]" });
        } else {
          console.error("[Cenaiva.send]", err);
        }
        await voice.speak(friendly);
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
          setTimeout(() => {
            if (isOpenRef.current && !textModeRef.current && !muteRef.current) void startListeningRef.current();
          }, RELISTEN_AFTER_ERROR_MS);
        }
        latency.summarize(turnId);
      }
    },
    [
      dispatch,
      orchestrator,
      voice,
      navigate,
      hasCard,
      latency,
      errorToast,
      setProcessing,
    ],
  );

  const startListening = useCallback(async () => {
    if (!isOpenRef.current) return;
    try {
      const { transcript, alternatives, stopped } = await voice.startListening(speechHintsRef.current);
      if (stopped) {
        emptyRelistenStreakRef.current = 0;
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (transcript.trim()) {
        emptyRelistenStreakRef.current = 0;
        await sendTranscript(transcript, { alternatives });
      } else if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
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
          if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
            void startListeningRef.current();
          }
        }, RELISTEN_AFTER_EMPTY_TURN_MS);
      }
    } catch (err) {
      // Transient errors (InvalidStateError, recognition-start-failed,
      // audio-capture hiccups) — retry once. "not-allowed" already flipped
      // voiceStatus to "error" in useCenaivaVoice; leave that UI alone so the
      // user sees the grant-access prompt and tapping it re-requests perms.
      const msg = (err as Error)?.message ?? "";
      const isPermDenied = msg === "not-allowed" || msg.includes("not-allowed");
      const isVoiceSttUnavailable =
        msg.includes("voice-stt-unavailable") ||
        msg.includes("deepgram-stt-unavailable") ||
        msg.includes("browser-stt-disabled");
      if (isPermDenied) return;
      if (isVoiceSttUnavailable) {
        emptyRelistenStreakRef.current = 0;
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        // Log the inner error so we can diagnose which Deepgram branch
        // failed (token-unavailable / http-401 / recorder-start-failed /
        // stream-unavailable / etc). The toast text is intentionally
        // generic for the user.
        errorToast(err, {
          fallback: "Voice transcription is unavailable right now.",
          duration: 3000,
          logTag: "[Cenaiva.stt]",
        });
        return;
      }
      emptyRelistenStreakRef.current += 1;
      if (emptyRelistenStreakRef.current >= MAX_EMPTY_RELISTENS) {
        emptyRelistenStreakRef.current = 0;
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        setTimeout(() => {
          if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
            void startListeningRef.current();
          }
        }, RELISTEN_AFTER_ERROR_MS);
      }
    }
  }, [voice, sendTranscript, dispatch, errorToast]);

  const shouldAutoListenOnOpen = useCallback(() => autoListenOnOpenRef.current, []);
  // True when the wake-word path passed a greetingText and the open()
  // flow is handling the speak — the shell's greeting effect uses this to
  // skip its own voice.speak() and avoid double-greeting.
  const wasGreetingHandledExternally = useCallback(
    () => !!greetingTextRef.current,
    [],
  );
  // Session-scoped greeting played flag. Per-mount `greetedRef` in
  // CenaivaVoiceShell resets on every unmount, so rapid open/close cycles
  // were firing 5× of "Good morning..." TTS attempts in one second (cache
  // catches them silently but the work is wasted). This flag persists
  // across the entire Cenaiva session and gets reset only when the user
  // logs out (the auth-change effect below clears it).
  const sessionGreetingPlayedRef = useRef<boolean>(false);
  const wasSessionGreetingPlayed = useCallback(
    () => sessionGreetingPlayedRef.current,
    [],
  );
  const markSessionGreetingPlayed = useCallback(() => {
    sessionGreetingPlayedRef.current = true;
  }, []);
  // Reset the session greeting flag when the user changes (logout → login).
  // Without this, a user who logs out and logs back in would never hear a
  // greeting again until they hard-reloaded the page.
  useEffect(() => {
    if (!user) {
      sessionGreetingPlayedRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const setSpeechHints = useCallback((hints: string[]) => {
    speechHintsRef.current = hints
      .map((hint) => hint.trim())
      .filter(Boolean)
      .slice(0, 12);
  }, []);

  const open = useCallback(
    (
      restaurantId?: string,
      restaurantName?: string,
      opts?: { autoListen?: boolean; greetingText?: string },
    ) => {
      // Kill switch — set VITE_CENAIVA_AI_DISABLED=true to hide the AI
      // assistant entirely. Use during incidents (LLM provider down, costs
      // spiking, bad behavior in prod). Users can still book via the public
      // restaurant pages directly.
      if (import.meta.env.VITE_CENAIVA_AI_DISABLED === "true") {
        toast.info("Voice booking is temporarily unavailable. Use the booking page instead.", {
          duration: 4000,
        });
        return;
      }
      autoListenOnOpenRef.current = opts?.autoListen === true;
      greetingTextRef.current = opts?.greetingText ?? null;
      isOpenRef.current = true;
      requestLocation();
      // Prime browser speech in the same user gesture that opens the shell.
      // This makes the Web Speech fallback audible on /discover even when
      // ElevenLabs is disabled or unavailable.
      try { voice.primeTTS(); } catch { /* noop */ }

      // Free the mic synchronously so the command recognizer can claim it
      // immediately without fighting the wake word for the stream.
      forceStopWakeWordRef.current();

      if (!micGrantedRef.current) {
        requestMicPermission().then((granted) => {
          if (granted) {
            micGrantedRef.current = true;
          }
        });
      }

      // Warm the Deepgram short-lived token cache in parallel with the mic
      // permission prompt. By the time the user finishes the wake word and
      // starts the utterance, the token is already in hand — saves the
      // 100-300ms /deepgram-live-token round-trip on the first turn.
      prefetchDeepgramToken();
      // Wake the orchestrator edge runtime so the user's first real turn
      // doesn't pay cold-start latency. Fire-and-forget.
      void orchestrator.prewarm();

      if (restaurantId && restaurantName) {
        dispatch({ type: "PRESELECT_RESTAURANT", restaurant_id: restaurantId, restaurant_name: restaurantName });
      } else {
        dispatch({ type: "OPEN" });
      }

      // Greet first, listen second — the wake-word path passes a personalized
      // greeting; bare orb taps don't pass one and just go straight to listen.
      // After the greeting plays, the mic should auto-open so the user can
      // speak their request without tapping anything. Two safety nets that
      // matter here:
      //   1. Defensive `stopListening()` before `startListening()` clears any
      //      half-released recognition session that the wake recognizer's
      //      tear-down might have left dangling. Without this, Chrome's
      //      "one SpeechRecognition holds the mic" rule can leave the new
      //      session stuck in idle.
      //   2. 200ms yield between greeting-end and `startListening()` lets
      //      Chrome reclaim the mic from the wake recognizer fully. Without
      //      it, the new session can race the wake recognizer's release and
      //      silently fail to open.
      // useCenaivaWakeWord.ts is off-limits per CLAUDE.md, so we work around
      // it here.
      if (opts?.autoListen && opts?.greetingText) {
        void (async () => {
          try {
            // Wake-word path: speak only if we haven't already played the
            // greeting this session. Mark it played after so the shell's
            // greeting effect also skips on subsequent opens.
            if (!sessionGreetingPlayedRef.current) {
              await voice.speak(opts.greetingText!);
              sessionGreetingPlayedRef.current = true;
            }
            voice.stopListening();
            await new Promise((resolve) => setTimeout(resolve, 200));
            if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
              try {
                await startListeningRef.current();
              } catch (err) {
                // Surface failures (Deepgram unavailable, permission denied,
                // mic still locked) instead of swallowing them — without this,
                // users see the orb and assume they need to tap to start.
                console.warn("[Cenaiva] startListening after wake greeting failed", err);
                if (isOpenRef.current && !textModeRef.current && !muteRef.current) {
                  await voice.speak("Tap the mic to start when ready.");
                }
              }
            }
          } catch (err) {
            console.warn("[Cenaiva] wake-greeting flow failed", err);
          }
        })();
      }
    },
    [dispatch, requestLocation, voice, orchestrator],
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

  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const close = useCallback(() => {
    isOpenRef.current = false;
    textModeRef.current = false;
    emptyRelistenStreakRef.current = 0;
    autoListenOnOpenRef.current = false;
    if (idleCloseTimerRef.current) {
      clearTimeout(idleCloseTimerRef.current);
      idleCloseTimerRef.current = null;
    }
    voiceRef.current.stopSpeaking();
    voiceRef.current.stopListening();
    dispatch({ type: "CLOSE" });
    // Always return the user to the discovery page when the Cenaiva flow ends
    // (post-booking save, decline preorder, payment success, manual close).
    // navigate() is a no-op if they are already on /discover.
    if (pathnameRef.current !== "/discover") navigate("/discover");
  }, [dispatch, navigate]);

  // Stable ref to close() so the idle timer's setTimeout callback can call
  // it without listing close in deps (which would re-create the scheduler
  // on every render).
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);

  // Restart the idle-close countdown. Called from every user activity site
  // (sendTranscript, AI response, on open). If the user is silent for
  // IDLE_AUTO_CLOSE_MS, gracefully close the assistant so the mic stops
  // burning Deepgram quota. We do NOT fire while voice is actively
  // listening / speaking / processing — those states aren't "idle".
  const scheduleIdleClose = useCallback(() => {
    if (idleCloseTimerRef.current) {
      clearTimeout(idleCloseTimerRef.current);
      idleCloseTimerRef.current = null;
    }
    if (!isOpenRef.current) return;
    idleCloseTimerRef.current = setTimeout(() => {
      idleCloseTimerRef.current = null;
      if (!isOpenRef.current) return;
      // Skip auto-close if voice is mid-turn. Re-arm the timer.
      const vs = stateRef.current.voiceStatus;
      if (vs === "listening" || vs === "processing" || vs === "speaking") {
        return;
      }
      if (import.meta.env.DEV) console.log("[Cenaiva] idle auto-close fired");
      closeRef.current();
    }, IDLE_AUTO_CLOSE_MS);
  }, []);

  // Restart the idle auto-close timer whenever the voiceStatus becomes idle
  // while the assistant is open. This covers every "AI just finished
  // speaking" / "user empty turn ended" moment without having to
  // instrument each callback individually. When voice is mid-flow
  // (listening / processing / speaking), don't run the countdown — the
  // status will flip back to idle when the turn ends.
  useEffect(() => {
    if (!state.isOpen) return;
    if (state.voiceStatus === "idle") {
      scheduleIdleClose();
    } else if (idleCloseTimerRef.current) {
      clearTimeout(idleCloseTimerRef.current);
      idleCloseTimerRef.current = null;
    }
  }, [state.isOpen, state.voiceStatus, scheduleIdleClose]);

  const sayGoodbyeAndClose = useCallback(
    async (message?: string, redirectAfter?: string) => {
      const finalMessage = message ?? "Enjoy your meal. Bye!";
      // Stop the mic so the farewell actually plays without fighting the
      // recognizer for the audio stream.
      isOpenRef.current = false;
      textModeRef.current = false;
      emptyRelistenStreakRef.current = 0;
      autoListenOnOpenRef.current = false;
      voiceRef.current.stopListening();
      dispatch({ type: "SET_LAST_SPOKEN_TEXT", text: finalMessage });
      try {
        await voiceRef.current.speak(finalMessage);
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

  // Bridge: sendTranscript (defined earlier) calls sayGoodbyeAndClose via
  // sayGoodbyeAndCloseRef when the orchestrator emits a `close_assistant`
  // ui_action. Refresh the ref whenever the callback identity changes.
  useEffect(() => {
    sayGoodbyeAndCloseRef.current = sayGoodbyeAndClose;
  }, [sayGoodbyeAndClose]);

  const setTextMode = useCallback((active: boolean) => {
    textModeRef.current = active;
    // Safety net: entering text mode should never be blocked by a stale
    // processing flag. If the previous voice turn hung (recognizer wedged,
    // orchestrator still in-flight when the user pivots to typing), clearing
    // the flag here guarantees the next Send goes through instead of being
    // silently dropped by the `if (processingRef.current) return;` guard.
    if (active) {
      setProcessing(false);
      emptyRelistenStreakRef.current = 0;
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    }
  }, [dispatch, setProcessing]);

  // After a successful payment the "You're all set!" confirmation renders
  // briefly. We speak a short farewell, then tear down the shell and navigate
  // back to /account (the customer dashboard) so the user lands on their
  // home screen rather than a paid receipt.
  const paidAckRef = useRef(false);
  useEffect(() => {
    if (state.booking.status !== "paid") {
      paidAckRef.current = false;
      return;
    }
    if (paidAckRef.current) return;
    paidAckRef.current = true;
    const t = setTimeout(() => {
      void sayGoodbyeAndClose("You're all set. Enjoy your meal. Bye!", "/account");
    }, 1500);
    return () => clearTimeout(t);
  }, [state.booking.status, sayGoodbyeAndClose]);

  const onWake = useCallback(() => {
    const now = Date.now();
    // Wake-word debounce: the recognizer's fuzzy phrase matcher
    // occasionally bursts multiple onWake calls in quick succession
    // (e.g. "hey sanibel" / "hey soniva" / "hey son iv" all matching as
    // "Hey Cenaiva"). Without a debounce, each one re-runs the greeting
    // + autoListen flow on top of itself.
    if (now - lastWakeFireMsRef.current < WAKE_DEBOUNCE_MS) {
      if (import.meta.env.DEV) console.log(`[WakeWord] debounced — ${now - lastWakeFireMsRef.current}ms since last fire`);
      return;
    }
    lastWakeFireMsRef.current = now;
    if (import.meta.env.DEV) console.log(`[WakeWord] onWake fired — user=${!!user} isCustomerRoute=${isCustomerRoute} isOpen=${isOpenRef.current}`);
    if (!user) return;
    if (isOpenRef.current) {
      if (import.meta.env.DEV) console.log("[WakeWord] skipped — assistant already open");
      return;
    }
    // Prime the audio pipeline again on wake so the greeting reliably plays.
    try { voice.primeTTS(); } catch { /* noop */ }
    const greetingText = buildWakeGreeting(user);
    open(undefined, undefined, { autoListen: true, greetingText });
  }, [user, open, voice]);

  const { setEnabled: setWakeWordEnabled, forceStop: forceStopWakeWord } =
    useCenaivaWakeWord(onWake);

  // Keep the ref in sync so open() — defined earlier in this component —
  // can tear down the wake-word recognizer synchronously before starting
  // the command recognizer.
  useEffect(() => {
    forceStopWakeWordRef.current = forceStopWakeWord;
  }, [forceStopWakeWord]);

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
      // 200 ms re-arm — long enough for the close animation to start, short
      // enough that a user saying "Hey Cenaiva" right after closing the
      // assistant doesn't hit a dead window where the wake recognizer is
      // neither active nor armed.
      const t = setTimeout(() => enableWakeWord(), 200);
      return () => clearTimeout(t);
    }
  }, [isCustomerRoute, state.isOpen, forceStopWakeWord, enableWakeWord]);

  // Memoize the context value so every consumer of useAssistant() doesn't
  // re-render on every state dispatch. Without this, the shell, rail, map,
  // and booking sheet all re-run on every tick of speech status / spoken
  // text / booking delta — the biggest contributor to the collecting_minimum_fields
  // render storm that was triggering "Page Unresponsive".
  const ctx = useMemo<AssistantContextValue>(
    () => ({
      open,
      close,
      sayGoodbyeAndClose,
      sendTranscript,
      startListening,
      shouldAutoListenOnOpen,
      setSpeechHints,
      setTextMode,
      wasGreetingHandledExternally,
      wasSessionGreetingPlayed,
      markSessionGreetingPlayed,
      isProcessing,
    }),
    [open, close, sayGoodbyeAndClose, sendTranscript, startListening, shouldAutoListenOnOpen, setSpeechHints, setTextMode, wasGreetingHandledExternally, wasSessionGreetingPlayed, markSessionGreetingPlayed, isProcessing],
  );

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as Record<string, unknown>;
    w.__cenaivaTest = {
      send: async (transcript: string, opts?: { restaurantId?: string; force?: boolean }) => {
        const baseline = stateRef.current.lastSpokenText ?? "";
        await sendTranscript(transcript, opts);
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
          const cur = stateRef.current.lastSpokenText ?? "";
          if (cur && cur !== baseline) {
            return {
              spokenText: cur,
              booking: stateRef.current.booking,
            };
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        return { spokenText: null, booking: stateRef.current.booking, timeout: true };
      },
      open: (rid?: string, greeting?: string, opts?: { autoListen?: boolean; greetingText?: string }) =>
        open(rid, greeting, opts),
      close: () => close(),
      getState: () => stateRef.current,
      getSpoken: () => stateRef.current.lastSpokenText,
      setTextMode: (on: boolean) => setTextMode(on),
    };
    return () => { delete w.__cenaivaTest; };
  }, [sendTranscript, open, close, setTextMode]);

  // Defense-in-depth: Hey Cenaiva is logged-in-users-only. The UI gate in
  // App.tsx already hides the FAB orb for anon users and the wake word
  // recognizer only fires when `isCustomerRoute` is true (which itself
  // requires `!!user`). This early-return ensures the assistant context
  // itself is unavailable to anon users so any descendant call to
  // useAssistant() returns null — preventing accidental future regressions
  // (e.g. someone adding a button that calls assistant.open() without
  // gating on user). All hooks above this line still run so the order is
  // stable across user state transitions.
  if (!user) return <>{children}</>;

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

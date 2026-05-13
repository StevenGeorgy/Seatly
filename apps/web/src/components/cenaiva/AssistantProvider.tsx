import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import { useCenaivaOrchestrator } from "@/hooks/useCenaivaOrchestrator";
import { useCenaivaVoice } from "@/hooks/useCenaivaVoice";
import { useCenaivaWakeWord } from "@/hooks/useCenaivaWakeWord";
import { useCenaivaSmallPrompt } from "@/hooks/useCenaivaSmallPrompt";
import { useCenaivaAvailability } from "@/hooks/useCenaivaAvailability";
import { useCenaivaLatencyBudget, type LatencyTransport } from "@/hooks/useCenaivaLatencyBudget";
import { useCenaivaVoicePreference } from "@/hooks/useCenaivaVoicePreference";
import { NOISE_ROBUST_AUDIO_CONSTRAINTS, prefetchDeepgramToken } from "@/hooks/useDeepgramTranscription";
import { useAssistantStore, AssistantStoreProvider } from "@/components/cenaiva/AssistantStore";
import {
  NO_AUTO_RELISTEN_STATUSES,
  RELISTEN_AFTER_RESPONSE_MS,
} from "@/components/cenaiva/assistantStoreConstants";
import { useUser } from "@/hooks/useUser";
import { useSavedCards } from "@/hooks/useSavedCards";
import { buildWakeGreeting } from "@/lib/cenaiva/buildWakeGreeting";
import {
  shouldRouteAsCenaivaBookingConfirmation,
  transcriptForCenaivaBookingConfirmation,
} from "@/lib/cenaiva/confirmationIntent";
import { isCenaivaProcessPrompt } from "@/lib/cenaiva/simplePromptIntent";
import {
  getCenaivaRecommendationMode,
  normalizeSingleRestaurantRecommendationResponse,
  applyClientDiscoveryMemory,
} from "@/lib/cenaiva/recommendationIntent";
import {
  buildLocalAvailabilityResponse,
  planLocalBookingTurn,
  type CenaivaAvailabilityOption,
} from "@/lib/cenaiva/localBookingCollector";
import type { AssistantResponseType, OrchestratorRequestType } from "@cenaiva/assistant";

const FAST_PATH_ENABLED = (import.meta.env.VITE_CENAIVA_FAST_PATH ?? "true") !== "false";

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
    opts?: { restaurantId?: string; silent?: boolean; force?: boolean },
  ) => Promise<void>;
  startListening: () => Promise<void>;
  shouldAutoListenOnOpen: () => boolean;
  setSpeechHints: (hints: string[]) => void;
  setTextMode: (active: boolean) => void;
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
// re-runs the open-greeting flow.
const WAKE_DEBOUNCE_MS = 3_000;

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
  const smallPrompt = useCenaivaSmallPrompt();
  const availability = useCenaivaAvailability();
  const voicePref = useCenaivaVoicePreference();
  const latency = useCenaivaLatencyBudget();
  const navigate = useNavigate();
  const { pathname } = useLocation();

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
  // Tracks options the user is still picking between after a Stage 2 result.
  // Mirrors mobile's `pendingOptions` slot in the assistant store.
  const pendingOptionsRef = useRef<CenaivaAvailabilityOption[]>([]);
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
  const MAX_EMPTY_RELISTENS = 20;

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

  // Helper: finish a local-stage turn — apply response, speak it, and
  // schedule relisten if the resulting booking status allows it.
  const finishLocalResponse = useCallback(
    async (
      response: AssistantResponseType,
      opts?: { schedule_relisten?: boolean; clearPendingOptions?: boolean },
    ) => {
      dispatch({ type: "APPLY_RESPONSE", response });
      if (opts?.clearPendingOptions) pendingOptionsRef.current = [];
      if (response.spoken_text) {
        await voice.speak(response.spoken_text);
      }
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
      processingRef.current = false;
      const next = stateRef.current;
      if (
        opts?.schedule_relisten &&
        isOpenRef.current &&
        !textModeRef.current &&
        !muteRef.current &&
        !NO_AUTO_RELISTEN_STATUSES.has(next.booking.status)
      ) {
        setTimeout(() => {
          if (isOpenRef.current && !textModeRef.current && !muteRef.current) void startListeningRef.current();
        }, RELISTEN_AFTER_RESPONSE_MS);
      }
    },
    [dispatch, voice],
  );

  const sendTranscript = useCallback(
    async (
      transcript: string,
      opts?: { restaurantId?: string; silent?: boolean; force?: boolean },
    ) => {
      const turnId = ++turnIdRef.current;
      latency.start(turnId);
      latency.mark(turnId, "transcriptAt");

      if (processingRef.current) {
        if (!opts?.force) return;
        orchestrator.cancel();
        processingRef.current = false;
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
      const isBookingConfirmationReply = shouldRouteAsCenaivaBookingConfirmation(
        current.booking.status,
        transcript,
      );
      const orchestratorTranscript = transcriptForCenaivaBookingConfirmation(
        current.booking.status,
        transcript,
      );
      const isProcessPrompt = isCenaivaProcessPrompt(transcript);
      const recommendationMode = getCenaivaRecommendationMode(transcript);
      const browserTimeZone =
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;

      // ── STAGE 1 — local booking collector ───────────────────────────────────
      // Skip Stage 1 for clear greetings / chit-chat / off-topic that contain
      // a stray date/time word ("how are you doing today", "good morning",
      // "what's up tonight"). Without this guard the local collector parses
      // "today"/"tonight"/etc. out of the greeting, treats it as a booking
      // detail, and asks "what restaurant or area should I book?" — which
      // sounds robotic and ignores the actual greeting.
      const isPureGreeting = /^\s*(hey|hi|hello|yo|yoo+|sup|what'?s\s+up|good\s+(?:morning|afternoon|evening|night)|howdy|wassup|how\s+(?:are\s+you|is\s+it\s+going|you\s+doing))\b/i
        .test(transcript) && !/\b(book|reserve|table|reservation|find|show|search|recommend|hungry|starving|eat|food)\b/i.test(transcript);
      // Skip Stage 1 for fact-lookup / global discovery questions like "what
      // is X about", "any deals tonight", "best cuisines", "closest spots".
      // Without this guard, planLocalBookingTurn parses "tonight"/"today" as
      // a date and routes to the availability check (Stage 2) — which then
      // returns the restaurant's HOURS instead of the orchestrator's
      // deterministic deals/about/etc handler.
      const isFactOrGlobalQuery = /\b(?:reviews?|ratings?|expensive|cheap|pricey|popular|best|top|favorite|favourite|deals?|promotions?|discounts?|specials?|offers?|coupons?|happy hour|closest|nearest|near me|nearby|close by|around me|walking distance|tell me about|known for|famous for|all about|menu|appetizers?|entrees?|mains?|starters?|desserts?|kids?\s+menu|drink\s+(?:list|menu)|wine\s+(?:list|menu)|beer\s+(?:list|menu)|cocktail\s+(?:list|menu)|dish(?:es)?|events?|happenings?|live music|trivia|wagyu|wine\s+pairing|tasting\s+(?:menu|night)|prix\s+fixe)\b/i.test(transcript) ||
        /\bwhat(?:'?s| is)\s+\w+(?:\s+\w+){0,3}\s+(?:about|like)\b/i.test(transcript) ||
        /\b(?:what|how)\s+(?:kind|type|sort)\s+of\b/i.test(transcript) ||
        /\bis\s+\w+(?:\s+\w+){0,3}\s+(?:a\s+(?:cafe|bar|brewery|brewpub|pub|bistro|deli|bakery|lounge|izakaya|restaurant|steakhouse)|fancy|romantic|casual|quiet|loud|trendy|hip|cozy|kid|family|good\s+for)\b/i.test(transcript) ||
        /\bdo\s+they\s+(?:have|serve)\s+(?:vegan|vegetarian|gluten[- ]?free|halal|kosher|fish|seafood|steak|pasta|burger|pizza|salad|brunch)\b/i.test(transcript);
      // Skip Stage 1 for modify/cancel referencing prior context ("modify it",
      // "cancel that", "change the booking"). Otherwise the local booking
      // collector parses "5pm" as a new booking time and asks "What restaurant
      // or area should I book?" — confusing because the user clearly meant to
      // act on an existing reservation. Orchestrator's modify/cancel branches
      // handle the right responses (including the "no active reservations"
      // case for cancelled-only history).
      const isModifyOrCancelRef = (/\b(modify|change|switch|reschedule|update|adjust|edit|move|push|bump|shift|cancel|drop|scrap|kill|nuke|abort|nix|delete|remove|forget|nevermind)\b/i.test(transcript) ||
        /\bmake\s+it\b/i.test(transcript)) &&
        /\b(it|that|that one|the booking|the reservation|my booking|my reservation)\b/i.test(transcript);
      // Also skip when user references "my reservation" / "my booking" — the
      // orchestrator owns those flows.
      const isReservationListQuery = /\b(my\s+(?:most\s+recent|latest|newest|last|next|upcoming|first|current|active)\s+(?:reservation|booking|table)|show\s+me\s+my\s+(?:reservation|booking|past|upcoming|cancelled)|list\s+my\s+(?:reservation|booking)|(?:do|did)\s+i\s+(?:have|book))\b/i.test(transcript);
      // Skip Stage 1 for indirect / tentative booking phrasings — "what about
      // X", "how about X", "can you get me into X", "any chance of a table at
      // Y", "thinking of going to Z", "feel like X". Without this guard, the
      // local collector parses time words ("tomorrow", "tonight") out of the
      // transcript, treats restaurant_id as missing, and emits the robotic
      // "What restaurant or area should I book?" prompt — confusing because
      // the transcript clearly NAMES a restaurant. The orchestrator's casual
      // booking handler does the proper fuzzy match. Smoke regression
      // 2026-05-11.
      const isIndirectBookingIntent = /\b(?:what\s+about|how\s+about|can\s+you\s+(?:get|fit|squeeze)\s+(?:me|us)|any\s+chance\s+(?:of|to\s+get|i\s+can\s+get)|thinking\s+(?:of|about)\s+(?:going|trying)|feel\s+like|hit\s+up|set\s+me\s+up|grab\s+us|snag|dinner\s+for|lunch\s+for|brunch\s+for|drinks\s+for|i\s+want\s+to\s+go\s+to|i'?d\s+like\s+to\s+(?:go|try)|let'?s\s+go\s+to|book\s+(?:me\s+)?(?:a\s+)?(?:table\s+)?at|reserve\s+(?:me\s+)?(?:a\s+)?(?:table\s+)?at|i\s+want\s+a\s+table|(?:take|bring|treat)\s+(?:my|the|our)\s+(?:girlfriend|boyfriend|wife|husband|partner|family|kids|date|gf|bf|friend|buddy|mate|mom|mum|dad|sister|brother|cousin|coworker|colleague|spouse|fiance|fiancee))\b/i.test(transcript);
      if (FAST_PATH_ENABLED && !isPureGreeting && !isFactOrGlobalQuery && !isModifyOrCancelRef && !isReservationListQuery && !isIndirectBookingIntent) {
        const decision = planLocalBookingTurn({
          transcript,
          booking: current.booking,
          conversationId: current.conversationId,
          selectedRestaurantId: opts?.restaurantId ?? current.booking.restaurant_id,
          selectedRestaurantName: current.booking.restaurant_name,
          timezone: browserTimeZone || "America/Toronto",
          pendingOptions: pendingOptionsRef.current,
          lastAssistantPrompt: current.lastSpokenText || null,
        });

        if (decision.kind === "local_response") {
          if (voice.isStreamingTTSAvailable) voice.discardStreamingSpeech();
          await finishLocalResponse(decision.response, {
            schedule_relisten: true,
            clearPendingOptions: decision.clearPendingOptions,
          });
          latency.summarize(turnId);
          return;
        }

        if (decision.kind === "check_availability") {
          // Speak filler in parallel with the availability call. "One moment
          // please." is in COMMON_TTS_CACHE_TEXTS so playback is local-IDB
          // (sub-50ms) once the user has primed the cache.
          if (decision.filler) {
            if (voice.isStreamingTTSAvailable) {
              voice.speakStreamingChunk(decision.filler);
            } else {
              void voice.speak(decision.filler);
            }
          }
          dispatch({ type: "APPLY_RESPONSE", response: decision.responseBeforeCheck });
          const controller = new AbortController();
          const timer = window.setTimeout(() => controller.abort(), 20_000);
          try {
            const { data: result } = await availability.check(
              decision.request as unknown as Record<string, unknown>,
              { signal: controller.signal },
            );
            if (!result) {
              if (voice.isStreamingTTSAvailable) voice.discardStreamingSpeech();
              await voice.speak(
                "I could not reach live availability. Try another date and time, or ask for the restaurant hours.",
              );
              dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
              processingRef.current = false;
              latency.summarize(turnId);
              return;
            }
            const { response: availResponse, pendingOptions } =
              buildLocalAvailabilityResponse({
                conversationId: current.conversationId,
                request: decision.request,
                result: result as unknown as Parameters<
                  typeof buildLocalAvailabilityResponse
                >[0]["result"],
              });
            pendingOptionsRef.current = pendingOptions;
            if (voice.isStreamingTTSAvailable) voice.discardStreamingSpeech();
            await finishLocalResponse(availResponse, { schedule_relisten: true });
          } finally {
            window.clearTimeout(timer);
          }
          latency.summarize(turnId);
          return;
        }
        // decision.kind === 'pass' → continue to Stage 3 / 4
      }

      // ── STAGE 3 — small-prompt fast-path ─────────────────────────────────────
      // Skip when the user is replying yes/no to a confirmation prompt or when
      // the transcript is clearly a process/booking prompt (those go to the
      // orchestrator so the booking flow proceeds correctly). Also skip when a
      // pending_action (modify/cancel/save_preference) is queued — the user's
      // next reply is a yes/no on THAT action and must reach the orchestrator's
      // confirmPendingAction handler, not the small-prompt LLM (which would
      // emit a fresh booking-flow prompt and silently drop the pending action).
      const hasPendingAction = !!current.booking.pending_action;
      // Mid-booking affirmative — when the user has already named a restaurant
      // (restaurant_id set) and replies with a short yes/sure/ok/sounds good,
      // route to the orchestrator so the booking flow continues. Without this
      // guard, "yes" alone goes to small-prompt and the booking state silently
      // resets. Smoke regression 2026-05-12.
      const isMidBookingAffirmative =
        !!current.booking.restaurant_id &&
        /^(?:yes|yeah|yep|yup|sure|ok|okay|sounds good|sounds great|please|go ahead|let'?s do it|do it|book it|absolutely|definitely|of course)\b/i.test(
          transcript.trim(),
        );
      if (FAST_PATH_ENABLED && !isBookingConfirmationReply && !isProcessPrompt && !hasPendingAction && !isMidBookingAffirmative) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8_000);
        try {
          const { data: smallResult } = await smallPrompt.send(
            {
              transcript,
              booking: {
                restaurant_id: current.booking.restaurant_id,
                restaurant_name: current.booking.restaurant_name,
                party_size: current.booking.party_size,
                date: current.booking.date,
                time: current.booking.time,
              },
              voice_id: voicePref.voiceId,
            },
            { signal: controller.signal },
          );
          if (smallResult) {
            const asResponse: AssistantResponseType = {
              conversation_id: current.conversationId ?? "",
              spoken_text: smallResult.spoken_text,
              intent: "general_question" as AssistantResponseType["intent"],
              step: "general" as AssistantResponseType["step"],
              next_expected_input:
                smallResult.next_expected_input as AssistantResponseType["next_expected_input"],
              ui_actions: [],
              booking: null,
              map: null,
              filters: null,
              assistant_memory: null,
            };
            await finishLocalResponse(asResponse, { schedule_relisten: true });
            latency.summarize(turnId);
            return;
          }
          // null → fall through to Stage 4
        } catch {
          // abort or fetch error → fall through to Stage 4
        } finally {
          window.clearTimeout(timer);
        }
      }

      // ── STAGE 4 — full orchestrator (with recommendation_mode + memory) ─────
      const req: OrchestratorRequestType = {
        transcript: orchestratorTranscript,
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
        processingRef.current = false;

        if (!rawResponse) {
          // Orchestrator returned null (network / timeout / 500). Handle text
          // mode and voice mode differently: chat users can see a banner + toast,
          // voice users need an audible retry cue. Discard any partially-
          // queued streaming audio so the user doesn't hear half a sentence.
          if (streamingActive) voice.discardStreamingSpeech();
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
          processingRef.current = false;
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
        processingRef.current = false;
        if (streamingActive) voice.discardStreamingSpeech();
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
      smallPrompt,
      availability,
      voicePref.voiceId,
      finishLocalResponse,
    ],
  );

  const startListening = useCallback(async () => {
    if (!isOpenRef.current) return;
    try {
      const { transcript, stopped } = await voice.startListening(speechHintsRef.current);
      if (stopped) {
        emptyRelistenStreakRef.current = 0;
        dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
        return;
      }
      if (transcript.trim()) {
        emptyRelistenStreakRef.current = 0;
        await sendTranscript(transcript);
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
        toast.error("Voice transcription is unavailable right now.", { duration: 3000 });
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
  }, [voice, sendTranscript, dispatch]);

  const shouldAutoListenOnOpen = useCallback(() => autoListenOnOpenRef.current, []);

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
      // Wake the orchestrator + small-prompt edge runtimes so the user's
      // first real turn doesn't pay cold-start latency. Fire-and-forget.
      void orchestrator.prewarm();
      smallPrompt.prewarm(voicePref.voiceId);

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
            await voice.speak(opts.greetingText!);
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
    [dispatch, requestLocation, voice, orchestrator, smallPrompt, voicePref.voiceId],
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
      processingRef.current = false;
      emptyRelistenStreakRef.current = 0;
      dispatch({ type: "SET_VOICE_STATUS", status: "idle" });
    }
  }, [dispatch]);

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
    () => ({
      open,
      close,
      sayGoodbyeAndClose,
      sendTranscript,
      startListening,
      shouldAutoListenOnOpen,
      setSpeechHints,
      setTextMode,
    }),
    [open, close, sayGoodbyeAndClose, sendTranscript, startListening, shouldAutoListenOnOpen, setSpeechHints, setTextMode],
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
              uiActions: stateRef.current.ui_actions ?? [],
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

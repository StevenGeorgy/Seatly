import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
} from "@/lib/supabase/client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type HoldErrorReason =
  | "no_table"
  | "over_cover_cap"
  | "diner_double_book"
  | "rate_limited"
  | "network"
  | "unknown";

export type HoldState =
  | { status: "idle" }
  | { status: "creating"; clientToken: string | null }
  | {
      status: "active";
      holdId: string;
      clientToken: string | null;
      expiresAt: string;
      secondsLeft: number;
      serverSkewMs: number;
      depositAmountCents: number;
      confirmationCode: string;
      tableIds: string[];
      durationMinutes: number;
    }
  | { status: "expired"; holdId: string }
  | { status: "converting" }
  | { status: "confirmed"; reservationId: string; confirmationCode: string }
  | { status: "error"; message: string; reason: HoldErrorReason };

export type HoldVisualState = "calm" | "warning" | "urgent";

export interface UseReservationHoldArgs {
  restaurantId: string | null;
  shiftId: string | null;
  /** ISO timestamp */
  dateTime: string | null;
  partySize: number;
  /** Set true once user enters Step 1; false disables entirely. */
  enabled: boolean;
  source?: "web" | "cenaiva";
  eventId?: string | null;
  promotionId?: string | null;
  appliedPromoCode?: string | null;
  /**
   * Page-scoped timer rule (2026-05): the silent sessionStorage rehydrate
   * is gone. The only way to resume a persisted hold across mounts is to
   * pass its ID explicitly here — typically from `?hold=<id>` set by a
   * voice handoff. Without a match, any persisted entry is cleared and
   * the auto-create effect mints a fresh hold + fresh timer.
   */
  resumeHoldId?: string | null;
  /**
   * Set true once the diner enters the payment flow (Stripe PI created OR
   * checkout step rendered). When true, the pagehide unload cleanup will
   * NOT cancel the server-side hold — only the local sessionStorage entry
   * is cleared. Reason: there's a 1-2s race between Stripe PI succeeding
   * and `confirm-hold-paid` firing where the user could close the tab. If
   * our cancel beats the webhook, the diner's card is charged but the
   * hold is `cancelled` so the webhook's convert RPC silently fails — no
   * reservation, no refund. Letting the hold expire naturally (30 min)
   * lets the webhook recover. Server-side webhook also catches this case
   * by auto-refunding if needed (see RESERVATION_HOLDS_AUDIT.md).
   */
  inPaymentFlow?: boolean;
}

export interface UpdateDinerInput {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  specialRequest?: string | null;
  dietaryNotes?: string | null;
  occasion?: string | null;
  seatingPreference?: string | null;
}

export interface UseReservationHoldReturn {
  state: HoldState;
  visualState: HoldVisualState;
  createHold: () => Promise<{ holdId: string; expiresAt: string } | null>;
  updateDiner: (input: UpdateDinerInput) => Promise<{ ok: boolean; reason?: string }>;
  updateCart: (
    cartSnapshot: Record<string, unknown>,
    totalAmountCents: number,
  ) => Promise<{ ok: boolean }>;
  grabAgain: () => Promise<boolean>;
  cancelHold: () => Promise<void>;
  confirmConverted: (reservationId: string, confirmationCode: string) => void;
}

// ---------------------------------------------------------------------------
// Internal response shapes
// ---------------------------------------------------------------------------

interface CreateHoldResponse {
  ok?: boolean;
  hold_id?: string;
  client_token?: string;
  expires_at?: string;
  server_now?: string;
  deposit_amount_cents?: number;
  confirmation_code?: string;
  table_ids?: string[];
  duration_minutes?: number;
  error?: string;
  reason?: string;
  unavailable_reason?: string;
}

interface CancelHoldResponse {
  ok?: boolean;
  cancelled?: boolean;
  error?: string;
  reason?: string;
}

interface HeartbeatResponse {
  ok?: boolean;
  expires_at?: string;
  server_now?: string;
  error?: string;
}

interface UpdateResponse {
  ok?: boolean;
  error?: string;
  reason?: string;
}

interface PersistedHold {
  holdId: string;
  clientToken: string | null;
  expiresAt: string;
  depositAmountCents: number;
  confirmationCode: string;
  tableIds: string[];
  durationMinutes: number;
  serverSkewMs: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVE_WINDOW_MS = 120_000;
const HEARTBEAT_EXTEND_SECONDS = 120;

function getStorageKey(restaurantId: string, dateTime: string): string {
  return `cenaiva:hold:${restaurantId}:${dateTime}`;
}

function loadPersisted(key: string): PersistedHold | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedHold>;
    if (
      typeof parsed.holdId !== "string" ||
      typeof parsed.expiresAt !== "string" ||
      typeof parsed.confirmationCode !== "string"
    ) {
      return null;
    }
    // If already expired (per local clock + skew), drop it.
    const skew = typeof parsed.serverSkewMs === "number" ? parsed.serverSkewMs : 0;
    if (Date.parse(parsed.expiresAt) <= Date.now() + skew) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return {
      holdId: parsed.holdId,
      clientToken: typeof parsed.clientToken === "string" ? parsed.clientToken : null,
      expiresAt: parsed.expiresAt,
      depositAmountCents:
        typeof parsed.depositAmountCents === "number" ? parsed.depositAmountCents : 0,
      confirmationCode: parsed.confirmationCode,
      tableIds: Array.isArray(parsed.tableIds) ? parsed.tableIds.filter((t): t is string => typeof t === "string") : [],
      durationMinutes:
        typeof parsed.durationMinutes === "number" ? parsed.durationMinutes : 0,
      serverSkewMs: skew,
    };
  } catch {
    return null;
  }
}

function savePersisted(key: string, value: PersistedHold): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / privacy mode failures
  }
}

function clearPersisted(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function mapErrorReason(
  status: number,
  bodyReason: string | undefined,
): HoldErrorReason {
  if (status === 429) return "rate_limited";
  const r = (bodyReason ?? "").toLowerCase();
  if (r.includes("no_table") || r === "no_tables" || r === "unavailable") return "no_table";
  if (r.includes("cover") || r.includes("over_cap")) return "over_cover_cap";
  if (r.includes("double_book") || r.includes("diner_double_book")) return "diner_double_book";
  if (r === "rate_limited") return "rate_limited";
  return "unknown";
}

function computeVisual(secondsLeft: number): HoldVisualState {
  if (secondsLeft > 300) return "calm";
  if (secondsLeft > 60) return "warning";
  return "urgent";
}

async function postFn<T>(path: string, body: Record<string, unknown>): Promise<{
  res: Response;
  body: T;
}> {
  const client = getSupabaseBrowserClient();
  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData.session?.access_token ?? null;
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: getSupabaseAnonKey(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => ({}))) as T;
  return { res, body: parsed };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReservationHold(args: UseReservationHoldArgs): UseReservationHoldReturn {
  const {
    restaurantId,
    shiftId,
    dateTime,
    partySize,
    enabled,
    source = "web",
    eventId = null,
    promotionId = null,
    appliedPromoCode = null,
    resumeHoldId = null,
    inPaymentFlow = false,
  } = args;

  // Keep the payment-flow flag in a ref so the pagehide cleanup (which has
  // empty deps) can read the current value without re-binding the listener.
  const inPaymentFlowRef = useRef<boolean>(inPaymentFlow);
  inPaymentFlowRef.current = inPaymentFlow;

  const [state, setState] = useState<HoldState>({ status: "idle" });

  // Persisted refs (don't trigger renders).
  const idempotencyKeyRef = useRef<string | null>(null);
  // `client_token` minted right before the createHold POST fires. Lets the
  // cleanup cancel even when the user navigates away DURING the ~500ms
  // create POST (we don't know hold_id yet, but the server stores the
  // client_token alongside, so cancel-by-client_token resolves to the same
  // row — or pre-tombstones it so the row is born 'cancelled' when create
  // lands). Reset on slot drift (new slot = new token) and on unmount.
  const clientTokenRef = useRef<string | null>(null);
  const lastActiveAtRef = useRef<number>(Date.now());
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const creatingInFlightRef = useRef<boolean>(false);
  const stateRef = useRef<HoldState>(state);
  const persistKeyRef = useRef<string | null>(null);
  // Tracks the (partySize, dateTime, shiftId) inputs the most recent
  // successful createHold ran with. The recreate-on-param-change effect
  // below compares the current inputs to this ref to detect drift. Set
  // INSIDE createHold (not from the effect) because the effect's deps don't
  // include state.status, so it wouldn't fire on the idle→creating→active
  // transition that follows the auto-create.
  const lastSyncedInputsRef = useRef<{
    partySize: number;
    dateTime: string;
    shiftId: string;
  } | null>(null);

  stateRef.current = state;

  // Storage key recomputed when inputs change.
  const storageKey = useMemo(() => {
    if (!restaurantId || !dateTime) return null;
    return getStorageKey(restaurantId, dateTime);
  }, [restaurantId, dateTime]);

  useEffect(() => {
    persistKeyRef.current = storageKey;
  }, [storageKey]);

  // -------------------------------------------------------------------------
  // createHold
  // -------------------------------------------------------------------------

  const createHold = useCallback(async (): Promise<{ holdId: string; expiresAt: string } | null> => {
    if (!enabled) return null;
    if (!restaurantId || !shiftId || !dateTime || !partySize || partySize <= 0) return null;
    if (creatingInFlightRef.current) return null;

    creatingInFlightRef.current = true;

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    // Mint a fresh client_token if we don't have one already. The cleanup
    // path uses this when the user navigates away before the create POST
    // returns — server has a tombstone mechanism so a cancel-by-client_token
    // arriving first will cause the row to be born 'cancelled'.
    if (!clientTokenRef.current) {
      clientTokenRef.current = crypto.randomUUID();
    }
    const clientToken = clientTokenRef.current;

    setState({ status: "creating", clientToken });

    try {
      const { res, body } = await postFn<CreateHoldResponse>("create-reservation-hold", {
        restaurant_id: restaurantId,
        shift_id: shiftId,
        date_time: dateTime,
        party_size: partySize,
        source,
        idempotency_key: idempotencyKeyRef.current,
        client_token: clientToken,
        event_id: eventId,
        promotion_id: promotionId,
        applied_promo_code: appliedPromoCode,
      });

      if (!res.ok || body.ok === false || !body.hold_id || !body.expires_at) {
        // Log the full server response so devs can see any Zod `issues`
        // array. User-facing message is the friendly `body.error` only.
        console.error("[useReservationHold.create] hold rejected", {
          status: res.status,
          body,
        });
        const reason = mapErrorReason(res.status, body.reason ?? body.unavailable_reason);
        setState({
          status: "error",
          message: body.error ?? `Could not hold table (${res.status}).`,
          reason,
        });
        return null;
      }

      const serverNow = body.server_now ? Date.parse(body.server_now) : Date.now();
      const serverSkewMs = serverNow - Date.now();
      const expiresAt = body.expires_at;
      const secondsLeft = Math.max(
        0,
        Math.floor((Date.parse(expiresAt) - (Date.now() + serverSkewMs)) / 1000),
      );

      // Prefer the server-echoed token (authoritative) but fall back to
      // what we sent in case the edge fn omits it from the response.
      const echoedToken =
        typeof body.client_token === "string" && body.client_token.length > 0
          ? body.client_token
          : clientToken;
      clientTokenRef.current = echoedToken;

      const next: HoldState = {
        status: "active",
        holdId: body.hold_id,
        clientToken: echoedToken,
        expiresAt,
        secondsLeft,
        serverSkewMs,
        depositAmountCents:
          typeof body.deposit_amount_cents === "number" ? body.deposit_amount_cents : 0,
        confirmationCode: body.confirmation_code ?? "",
        tableIds: Array.isArray(body.table_ids) ? body.table_ids : [],
        durationMinutes: typeof body.duration_minutes === "number" ? body.duration_minutes : 0,
      };
      setState(next);

      if (persistKeyRef.current) {
        savePersisted(persistKeyRef.current, {
          holdId: next.holdId,
          clientToken: next.clientToken,
          expiresAt: next.expiresAt,
          depositAmountCents: next.depositAmountCents,
          confirmationCode: next.confirmationCode,
          tableIds: next.tableIds,
          durationMinutes: next.durationMinutes,
          serverSkewMs: next.serverSkewMs,
        });
      }

      lastSyncedInputsRef.current = { partySize, dateTime, shiftId };

      return { holdId: next.holdId, expiresAt: next.expiresAt };
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
        reason: "network",
      });
      return null;
    } finally {
      creatingInFlightRef.current = false;
    }
  }, [
    enabled,
    restaurantId,
    shiftId,
    dateTime,
    partySize,
    source,
    eventId,
    promotionId,
    appliedPromoCode,
  ]);

  // -------------------------------------------------------------------------
  // updateDiner
  // -------------------------------------------------------------------------

  const updateDiner = useCallback(
    async (input: UpdateDinerInput): Promise<{ ok: boolean; reason?: string }> => {
      const current = stateRef.current;
      if (current.status !== "active") return { ok: false, reason: "no_active_hold" };
      try {
        const { res, body } = await postFn<UpdateResponse>("update-reservation-hold", {
          hold_id: current.holdId,
          full_name: input.name ?? undefined,
          email: input.email ?? undefined,
          phone: input.phone ?? undefined,
          special_request: input.specialRequest ?? undefined,
          dietary_notes: input.dietaryNotes ?? undefined,
          occasion: input.occasion ?? undefined,
          seating_preference: input.seatingPreference ?? undefined,
        });
        if (!res.ok || body.ok === false) {
          return { ok: false, reason: body.reason ?? body.error ?? `http_${res.status}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "network" };
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // updateCart
  // -------------------------------------------------------------------------

  const updateCart = useCallback(
    async (
      cartSnapshot: Record<string, unknown>,
      totalAmountCents: number,
    ): Promise<{ ok: boolean }> => {
      const current = stateRef.current;
      if (current.status !== "active") return { ok: false };
      try {
        const { res, body } = await postFn<UpdateResponse>("update-reservation-hold", {
          hold_id: current.holdId,
          cart_snapshot: cartSnapshot,
          total_amount_cents: totalAmountCents,
        });
        return { ok: res.ok && body.ok !== false };
      } catch (err) {
        console.warn("[ReservationHold.updateHold] failed", err);
        return { ok: false };
      }
    },
    [],
  );

  // -------------------------------------------------------------------------
  // cancelHold (explicit user-initiated)
  // -------------------------------------------------------------------------

  const cancelHold = useCallback(async (): Promise<void> => {
    const current = stateRef.current;
    const holdId = current.status === "active" || current.status === "expired" ? current.holdId : null;
    const clientToken = clientTokenRef.current;
    // Always clear local state regardless of network result.
    if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
    // Reset the client token before idle — a fresh createHold call will mint
    // a new one. Holding onto the old one would let a re-create accidentally
    // collide with the cancelled tombstone server-side.
    clientTokenRef.current = null;
    setState({ status: "idle" });
    if (!holdId && !clientToken) return;
    try {
      const { body } = await postFn<CancelHoldResponse>("cancel-reservation-hold", {
        ...(holdId ? { hold_id: holdId } : {}),
        ...(clientToken ? { client_token: clientToken } : {}),
      });
      if (import.meta.env.DEV && body.cancelled === false) {
        console.warn("[ReservationHold.cancelHold] server reports cancelled=false", body);
      }
    } catch (err) {
      // best-effort — log so operators can see if hold cleanup is silently
      // failing in production.
      console.warn("[ReservationHold.cancelHold] failed", err);
    }
  }, []);

  // -------------------------------------------------------------------------
  // grabAgain
  // -------------------------------------------------------------------------

  const grabAgain = useCallback(async (): Promise<boolean> => {
    // Cancel the OLD server-side hold first, then create a fresh one.
    // Without this, the new createHold collides with the still-'active'
    // expired row: the exclusion constraint on reservation_holds filters
    // by status only (not expires_at), so the cron-not-yet-flipped row
    // blocks the INSERT with diner_double_book until the cron sweeps it.
    const current = stateRef.current;
    const oldHoldId = current.status === "expired" ? current.holdId : null;
    const oldClientToken = clientTokenRef.current;
    if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
    idempotencyKeyRef.current = null; // fresh key for the new attempt
    clientTokenRef.current = null; // fresh client_token for the new attempt
    setState({ status: "idle" });
    if (oldHoldId || oldClientToken) {
      try {
        await postFn<CancelHoldResponse>("cancel-reservation-hold", {
          ...(oldHoldId ? { hold_id: oldHoldId } : {}),
          ...(oldClientToken ? { client_token: oldClientToken } : {}),
        });
      } catch (err) {
        // Best-effort — if cancel fails, createHold will surface the
        // diner_double_book and the user gets a real error message.
        console.warn("[ReservationHold.grabAgain] pre-cancel failed", err);
      }
    }
    const result = await createHold();
    return result !== null;
  }, [createHold]);

  // -------------------------------------------------------------------------
  // confirmConverted
  // -------------------------------------------------------------------------

  const confirmConverted = useCallback(
    (reservationId: string, confirmationCode: string): void => {
      if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
      // The hold has been converted to a reservation — the client_token has
      // done its job. Clear it so a stray cancel doesn't attempt to tombstone
      // anything (server should already report converted, but no point firing).
      clientTokenRef.current = null;
      setState({ status: "confirmed", reservationId, confirmationCode });
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Auto-hydrate from sessionStorage on mount / when key changes
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled || !storageKey) return;
    if (stateRef.current.status !== "idle") return;
    const persisted = loadPersisted(storageKey);
    if (!persisted) return;
    // Page-scoped timer rule: only an explicit `resumeHoldId` (typically
    // from a `?hold=<id>` voice-handoff URL) is allowed to resume a
    // persisted hold. Without a match, the entry is stale — the user
    // left the page and we're treating this as a fresh visit — so we
    // drop it and let the auto-create effect mint a new hold.
    if (!resumeHoldId || resumeHoldId !== persisted.holdId) {
      clearPersisted(storageKey);
      return;
    }
    // Hydrate requires the same full input set that `createHold` needs;
    // otherwise we'd land in `active` state but the drift effect's
    // sentinel `lastSyncedInputsRef` would stay null and slot/party
    // changes would silently skip the cancel+recreate path.
    if (!shiftId || !partySize || partySize <= 0) return;
    const secondsLeft = Math.max(
      0,
      Math.floor(
        (Date.parse(persisted.expiresAt) - (Date.now() + persisted.serverSkewMs)) / 1000,
      ),
    );
    if (secondsLeft <= 0) {
      clearPersisted(storageKey);
      return;
    }
    // Restore the client_token from persistence so the cleanup path can
    // still cancel-by-client_token even on a resumed hold (defense-in-depth;
    // we have holdId here, but symmetry keeps cleanup branches simple).
    clientTokenRef.current = persisted.clientToken;
    setState({
      status: "active",
      holdId: persisted.holdId,
      clientToken: persisted.clientToken,
      expiresAt: persisted.expiresAt,
      secondsLeft,
      serverSkewMs: persisted.serverSkewMs,
      depositAmountCents: persisted.depositAmountCents,
      confirmationCode: persisted.confirmationCode,
      tableIds: persisted.tableIds,
      durationMinutes: persisted.durationMinutes,
    });
    // Seed the drift sentinel so a subsequent party/slot change triggers
    // cancel+recreate. Without this, a resumed hold would freeze its
    // input snapshot (lastSyncedInputsRef stays null) and drift would
    // never fire.
    lastSyncedInputsRef.current = { partySize, dateTime: dateTime as string, shiftId };
  }, [enabled, storageKey, resumeHoldId, shiftId, partySize, dateTime]);

  // -------------------------------------------------------------------------
  // Auto-create on mount (when idle + enabled + inputs valid)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    const cur = stateRef.current.status;
    // Fire on first mount (`idle`) OR on input change after a failed prior
    // attempt (`error`). Without the `error` branch the hook gets stuck on
    // the first failure (e.g. diner_double_book on a stale slot) and the
    // banner never recovers when the user picks a different date/time/party.
    if (cur !== "idle" && cur !== "error") return;
    if (!restaurantId || !shiftId || !dateTime || !partySize || partySize <= 0) return;
    if (cur === "error") {
      // Mint a fresh idempotency key — the previous key may already be
      // bound to the failed attempt on the server side.
      idempotencyKeyRef.current = null;
    }
    void createHold();
  }, [enabled, restaurantId, shiftId, dateTime, partySize, createHold]);

  // -------------------------------------------------------------------------
  // Recreate-on-param-change: when the diner changes party_size, dateTime,
  // or shiftId while an active hold exists, the server-side row is stale
  // (the API contract has no UPDATE path for those fields — table assignment
  // must be recomputed from scratch). Cancel + recreate so the UI's party
  // and slot match the hold that ultimately converts to a reservation.
  // Debounced so rapid +/- clicks don't flood the server. The
  // lastSyncedInputsRef gets seeded INSIDE createHold on success, not here,
  // so this effect doesn't need state.status in its deps.
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    if (!restaurantId || !shiftId || !dateTime || !partySize || partySize <= 0) return;
    const last = lastSyncedInputsRef.current;
    if (!last) return; // No active hold yet — auto-create effect will handle it.
    if (
      last.partySize === partySize &&
      last.dateTime === dateTime &&
      last.shiftId === shiftId
    ) {
      return; // already in sync
    }
    // Param drift detected while a hold exists. Cancel + recreate.
    // Idempotency key must be reset so the server mints a NEW hold for the
    // new (party_size, date_time, shift_id) tuple — otherwise the edge fn
    // returns the original hold by key and we end up with the same stale
    // row that triggered this code path. Mirrors the `grabAgain` pattern.
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (cancelled) return;
      // Clear the OLD slot's persisted entry explicitly. `cancelHold`
      // only wipes `persistKeyRef.current`, but by now that has already
      // moved to the NEW slot's key (the storageKey useMemo + sync
      // effect ran when `dateTime` changed). Without this, the prior
      // slot's sessionStorage entry would be orphaned and would still
      // pass the page-scope gate if the user pinned `?hold=<id>` later.
      const prevDateTime = lastSyncedInputsRef.current?.dateTime ?? null;
      if (restaurantId && prevDateTime) {
        clearPersisted(getStorageKey(restaurantId, prevDateTime));
      }
      // cancelHold clears clientTokenRef internally — the OLD slot's cancel
      // uses the OLD token via the cleanup branch inside cancelHold.
      await cancelHold();
      if (cancelled) return;
      idempotencyKeyRef.current = null;
      // Defensive: cancelHold already nulled this, but spell it out so the
      // NEW slot's createHold mints a fresh token rather than reusing the
      // tombstoned one.
      clientTokenRef.current = null;
      await createHold();
      // lastSyncedInputsRef gets updated INSIDE createHold on success.
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [enabled, restaurantId, shiftId, dateTime, partySize, cancelHold, createHold]);

  // -------------------------------------------------------------------------
  // Countdown timer
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (state.status !== "active") {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      return;
    }

    const tick = () => {
      const s = stateRef.current;
      if (s.status !== "active") return;
      const secondsLeft = Math.max(
        0,
        Math.floor((Date.parse(s.expiresAt) - (Date.now() + s.serverSkewMs)) / 1000),
      );
      if (secondsLeft <= 0) {
        if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
        setState({ status: "expired", holdId: s.holdId });
        return;
      }
      if (secondsLeft !== s.secondsLeft) {
        setState({ ...s, secondsLeft });
      }
    };

    // Run immediately so the first tick is accurate.
    tick();
    countdownTimerRef.current = setInterval(tick, 1000);
    return () => {
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [state.status]);

  // -------------------------------------------------------------------------
  // visibilitychange — recompute immediately when tab returns
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const s = stateRef.current;
      if (s.status !== "active") return;
      const secondsLeft = Math.max(
        0,
        Math.floor((Date.parse(s.expiresAt) - (Date.now() + s.serverSkewMs)) / 1000),
      );
      if (secondsLeft <= 0) {
        if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
        setState({ status: "expired", holdId: s.holdId });
      } else if (secondsLeft !== s.secondsLeft) {
        setState({ ...s, secondsLeft });
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Activity listeners + heartbeat
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (typeof document === "undefined") return;
    const bump = () => {
      lastActiveAtRef.current = Date.now();
    };
    const opts: AddEventListenerOptions = { passive: true };
    document.addEventListener("keydown", bump, opts);
    document.addEventListener("pointerdown", bump, opts);
    document.addEventListener("input", bump, opts);
    return () => {
      document.removeEventListener("keydown", bump);
      document.removeEventListener("pointerdown", bump);
      document.removeEventListener("input", bump);
    };
  }, []);

  useEffect(() => {
    if (state.status !== "active") {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      return;
    }

    const fire = async () => {
      const s = stateRef.current;
      if (s.status !== "active") return;
      if (Date.now() - lastActiveAtRef.current >= ACTIVE_WINDOW_MS) return;
      try {
        const { res, body } = await postFn<HeartbeatResponse>("heartbeat-reservation-hold", {
          hold_id: s.holdId,
          extend_seconds: HEARTBEAT_EXTEND_SECONDS,
        });
        if (res.status === 410) {
          // Hold was killed server-side. Re-check local state — if the hold
          // was just converted on a different code path (browser-confirm or
          // create-public-booking returned success while this heartbeat was
          // in flight), the server now reports the hold as "converted" which
          // surfaces as 410. We must NOT overwrite a "confirmed" state with
          // "expired" or the user sees the recovery modal on top of the
          // success page.
          if (stateRef.current.status !== "active") return;
          if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
          setState({ status: "expired", holdId: s.holdId });
          return;
        }
        if (!res.ok || !body.expires_at) return;
        const serverNow = body.server_now ? Date.parse(body.server_now) : Date.now();
        const newSkew = serverNow - Date.now();
        const cur = stateRef.current;
        if (cur.status !== "active") return;
        const secondsLeft = Math.max(
          0,
          Math.floor((Date.parse(body.expires_at) - (Date.now() + newSkew)) / 1000),
        );
        const next: HoldState = {
          ...cur,
          expiresAt: body.expires_at,
          serverSkewMs: newSkew,
          secondsLeft,
        };
        setState(next);
        if (persistKeyRef.current) {
          savePersisted(persistKeyRef.current, {
            holdId: next.holdId,
            clientToken: next.clientToken,
            expiresAt: next.expiresAt,
            depositAmountCents: next.depositAmountCents,
            confirmationCode: next.confirmationCode,
            tableIds: next.tableIds,
            durationMinutes: next.durationMinutes,
            serverSkewMs: next.serverSkewMs,
          });
        }
      } catch (err) {
        // ignore transient network errors; next tick retries. Log so a
        // persistent failure stays visible in DevTools.
        console.warn("[ReservationHold.heartbeat] tick failed", err);
      }
    };

    heartbeatTimerRef.current = setInterval(() => {
      void fire();
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [state.status]);

  // -------------------------------------------------------------------------
  // Unmount: best-effort cancel via sendBeacon when hold is still active
  // -------------------------------------------------------------------------

  useEffect(() => {
    const cleanup = () => {
      const s = stateRef.current;
      const persistKey = persistKeyRef.current;
      // Page-scoped rule: clear the local trace FIRST and synchronously.
      // Even if the cancel below fails (network, auth), a remount won't
      // find a persisted entry and so will mint a fresh hold via the
      // auto-create path. Leave = die.
      if (persistKey) clearPersisted(persistKey);
      // Skip the server-side cancel if the diner has entered the payment
      // flow. See `inPaymentFlow` prop docs — race-window-protection so the
      // webhook can still convert a paid hold even if the user closes the
      // tab in the gap between Stripe PI succeeding and `confirm-hold-paid`
      // firing. Local sessionStorage is still wiped above; the hold will
      // expire naturally after 30 min if booking is abandoned.
      if (inPaymentFlowRef.current) {
        clientTokenRef.current = null;
        return;
      }
      if (typeof navigator === "undefined") return;
      // Resolve identifiers. The cleanup ALWAYS fires a cancel (no
      // early-return on status !== "active") so we catch the
      // navigated-away-during-create race: hold_id isn't known yet, but
      // client_token IS. The server tombstones on client_token so a cancel
      // arriving before create completes still causes the eventual row to
      // be born 'cancelled'.
      const holdId =
        s.status === "active" || s.status === "expired" ? s.holdId : null;
      const clientToken = clientTokenRef.current;
      // Reset clientTokenRef now — the in-flight request below holds its
      // own local copy. Prevents a remount-then-unmount-again pattern from
      // double-cancelling on the same token.
      clientTokenRef.current = null;
      if (!holdId && !clientToken) return;
      try {
        const url = `${getSupabaseProjectUrl()}/functions/v1/cancel-reservation-hold`;
        const anon = getSupabaseAnonKey();
        // Pull the JWT from the @supabase/ssr cookie so the cancel edge fn
        // accepts the call. sendBeacon can't set headers, but
        // `fetch(..., { keepalive: true })` survives page unload AND lets
        // us include Authorization. Without auth, the server returns 401
        // and the hold leaks, blocking the user from a fresh slot on
        // return — defeating the page-scoped rule.
        let bearer: string | null = null;
        if (typeof document !== "undefined") {
          const cookie = document.cookie
            .split(";")
            .map((c) => c.trim())
            .find((c) => c.startsWith("sb-") && c.includes("-auth-token="));
          if (cookie) {
            const eq = cookie.indexOf("=");
            const raw = decodeURIComponent(cookie.slice(eq + 1));
            const stripped = raw.startsWith("base64-") ? atob(raw.slice("base64-".length)) : raw;
            try {
              const parsed = JSON.parse(stripped) as { access_token?: unknown };
              if (typeof parsed.access_token === "string") bearer = parsed.access_token;
            } catch {
              // ignore — cookie shape isn't what we expected; cancel will go unauthenticated.
            }
          }
        }
        const cancelBody: Record<string, string> = {};
        if (holdId) cancelBody.hold_id = holdId;
        if (clientToken) cancelBody.client_token = clientToken;
        const pending = fetch(url, {
          method: "POST",
          headers: {
            apikey: anon,
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify(cancelBody),
          keepalive: true,
        });
        // Dev-only observability: surface no-op cancels so we can see in
        // dev when a cancel landed on a row that was already gone (which
        // usually means the create POST returned but UI never saw it, or
        // the tombstone path raced as expected).
        if (import.meta.env.DEV) {
          void pending
            .then(async (res) => {
              const parsed = (await res
                .json()
                .catch(() => ({}))) as CancelHoldResponse;
              if (parsed.cancelled === false) {
                console.warn(
                  "[ReservationHold.cleanup] server reports cancelled=false",
                  { status: res.status, body: parsed, holdId, clientToken },
                );
              }
            })
            .catch((err: unknown) => {
              console.warn("[ReservationHold.cleanup] cancel response error", err);
            });
        } else {
          // Drop the promise — keepalive request continues in the background.
          void pending.catch(() => {
            /* unmount path — nothing useful to do here */
          });
        }
      } catch (err) {
        // best-effort — fetch may throw on quota/CSP edge cases.
        console.warn("[ReservationHold.cleanup] cancel-on-unload failed", err);
      }
    };
    // React unmount path (Link / useNavigate / route change). Fires when
    // the component tree tears down but the JS context survives.
    // Pagehide path (hard navigation, F5, tab close, browser back/forward).
    // React's cleanup does NOT fire reliably for these — the JS context is
    // about to be destroyed. pagehide is the canonical event for sendBeacon.
    // sendBeacon + sessionStorage.removeItem are both synchronous-enough to
    // complete inside the pagehide handler before the page tears down.
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", cleanup);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("pagehide", cleanup);
      }
      cleanup();
    };
    // We intentionally do not re-create this on state changes — the cleanup
    // closes over the latest stateRef and only fires on actual unmount /
    // page unload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------------------
  // Disabled → drop any active state without server cancel (caller's call).
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (enabled) return;
    if (stateRef.current.status === "idle") return;
    // Just clear local; do NOT cancel server-side. Disabling typically means
    // the inputs changed and a new hold for a different slot is about to begin.
    clientTokenRef.current = null;
    setState({ status: "idle" });
  }, [enabled]);

  // -------------------------------------------------------------------------
  // Derived visual state
  // -------------------------------------------------------------------------

  const visualState = useMemo<HoldVisualState>(() => {
    if (state.status !== "active") return "calm";
    return computeVisual(state.secondsLeft);
  }, [state]);

  return {
    state,
    visualState,
    createHold,
    updateDiner,
    updateCart,
    grabAgain,
    cancelHold,
    confirmConverted,
  };
}

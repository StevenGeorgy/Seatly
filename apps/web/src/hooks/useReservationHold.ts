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
  | { status: "creating" }
  | {
      status: "active";
      holdId: string;
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
  } = args;

  const [state, setState] = useState<HoldState>({ status: "idle" });

  // Persisted refs (don't trigger renders).
  const idempotencyKeyRef = useRef<string | null>(null);
  const lastActiveAtRef = useRef<number>(Date.now());
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const creatingInFlightRef = useRef<boolean>(false);
  const stateRef = useRef<HoldState>(state);
  const persistKeyRef = useRef<string | null>(null);

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
    setState({ status: "creating" });

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    try {
      const { res, body } = await postFn<CreateHoldResponse>("create-reservation-hold", {
        restaurant_id: restaurantId,
        shift_id: shiftId,
        date_time: dateTime,
        party_size: partySize,
        source,
        idempotency_key: idempotencyKeyRef.current,
        event_id: eventId,
        promotion_id: promotionId,
        applied_promo_code: appliedPromoCode,
      });

      if (!res.ok || body.ok === false || !body.hold_id || !body.expires_at) {
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

      const next: HoldState = {
        status: "active",
        holdId: body.hold_id,
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
          expiresAt: next.expiresAt,
          depositAmountCents: next.depositAmountCents,
          confirmationCode: next.confirmationCode,
          tableIds: next.tableIds,
          durationMinutes: next.durationMinutes,
          serverSkewMs: next.serverSkewMs,
        });
      }

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
      } catch {
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
    // Always clear local state regardless of network result.
    if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
    setState({ status: "idle" });
    if (!holdId) return;
    try {
      await postFn<UpdateResponse>("cancel-reservation-hold", { hold_id: holdId });
    } catch {
      // best-effort
    }
  }, []);

  // -------------------------------------------------------------------------
  // grabAgain
  // -------------------------------------------------------------------------

  const grabAgain = useCallback(async (): Promise<boolean> => {
    if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
    idempotencyKeyRef.current = null; // fresh key for the new attempt
    setState({ status: "idle" });
    const result = await createHold();
    return result !== null;
  }, [createHold]);

  // -------------------------------------------------------------------------
  // confirmConverted
  // -------------------------------------------------------------------------

  const confirmConverted = useCallback(
    (reservationId: string, confirmationCode: string): void => {
      if (persistKeyRef.current) clearPersisted(persistKeyRef.current);
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
    setState({
      status: "active",
      holdId: persisted.holdId,
      expiresAt: persisted.expiresAt,
      secondsLeft,
      serverSkewMs: persisted.serverSkewMs,
      depositAmountCents: persisted.depositAmountCents,
      confirmationCode: persisted.confirmationCode,
      tableIds: persisted.tableIds,
      durationMinutes: persisted.durationMinutes,
    });
  }, [enabled, storageKey]);

  // -------------------------------------------------------------------------
  // Auto-create on mount (when idle + enabled + inputs valid)
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!enabled) return;
    if (stateRef.current.status !== "idle") return;
    if (!restaurantId || !shiftId || !dateTime || !partySize || partySize <= 0) return;
    void createHold();
  }, [enabled, restaurantId, shiftId, dateTime, partySize, createHold]);

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
            expiresAt: next.expiresAt,
            depositAmountCents: next.depositAmountCents,
            confirmationCode: next.confirmationCode,
            tableIds: next.tableIds,
            durationMinutes: next.durationMinutes,
            serverSkewMs: next.serverSkewMs,
          });
        }
      } catch {
        // ignore transient network errors; next tick retries
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
    return () => {
      const s = stateRef.current;
      if (s.status !== "active") return;
      if (typeof navigator === "undefined") return;
      try {
        const url = `${getSupabaseProjectUrl()}/functions/v1/cancel-reservation-hold`;
        const payload = JSON.stringify({ hold_id: s.holdId });
        if (typeof navigator.sendBeacon === "function") {
          const blob = new Blob([payload], { type: "application/json" });
          navigator.sendBeacon(url, blob);
        }
      } catch {
        // best-effort
      }
    };
    // We intentionally do not re-create this on state changes — the cleanup
    // closes over the latest stateRef and only fires on actual unmount.
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

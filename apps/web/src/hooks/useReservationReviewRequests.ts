import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { useUser } from "@/hooks/useUser";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ReviewRequest = {
  notification_id: string;
  reservation_id: string;
  restaurant_id: string;
  restaurant_name: string;
  reserved_at: string;
};

type PendingReviewRequestRow = {
  notification_id?: string | null;
  reservation_id?: string | null;
  restaurant_id?: string | null;
  restaurant_name?: string | null;
  reserved_at?: string | null;
};

const DISMISSED_STORAGE_PREFIX = "cenaiva:review-prompt-dismissed:";
const REVIEW_REQUEST_CHECK_MS = 60_000;

function normalizeReviewRequests(rows: PendingReviewRequestRow[] | null): ReviewRequest[] {
  return (rows ?? [])
    .map((row) => ({
      notification_id: row.notification_id ?? "",
      reservation_id: row.reservation_id ?? "",
      restaurant_id: row.restaurant_id ?? "",
      restaurant_name: row.restaurant_name ?? "Restaurant",
      reserved_at: row.reserved_at ?? "",
    }))
    .filter((row) => row.notification_id && row.reservation_id && row.restaurant_id && row.reserved_at);
}

function dismissedStorageKey(reservationId: string): string {
  return `${DISMISSED_STORAGE_PREFIX}${reservationId}`;
}

function hasDismissedPrompt(reservationId: string): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(dismissedStorageKey(reservationId)) === "1";
}

function setDismissedPrompt(reservationId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(dismissedStorageKey(reservationId), "1");
}

function clearDismissedPrompt(reservationId: string): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(dismissedStorageKey(reservationId));
}

function dispatchNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("cenaiva:notifications-changed"));
}

export type SubmitOutcome = "success" | "already-reviewed";

// ---------------------------------------------------------------------------
// Module-level singleton store.
//
// Both the global modal (<ReservationReviewPrompt/>) AND the Discover banner
// (<DiscoverReviewBanner/>) call `useReservationReviewRequests()`. Without a
// shared store, each consumer would (a) double-fire the 60s poll, and (b)
// crash trying to register a second postgres_changes callback on the same
// realtime channel — the same gotcha CLAUDE.md describes for
// useAvailabilityRealtimeInvalidate. We solve both with a refcounted singleton
// + useSyncExternalStore.
// ---------------------------------------------------------------------------

type StoreSnapshot = {
  userId: string | null;
  requests: ReviewRequest[];
  dismissedIds: ReadonlySet<string>;
};

const EMPTY_SET: ReadonlySet<string> = new Set();

const store = {
  snapshot: { userId: null, requests: [], dismissedIds: EMPTY_SET } as StoreSnapshot,
  listeners: new Set<() => void>(),
  refcount: 0,
  channel: null as RealtimeChannel | null,
  pollTimer: null as number | null,
  visibilityListener: null as (() => void) | null,
  focusListener: null as (() => void) | null,
};

function emit() {
  for (const l of store.listeners) l();
}

function setSnapshot(next: StoreSnapshot) {
  store.snapshot = next;
  emit();
}

async function refreshFromRpc(): Promise<void> {
  const userId = store.snapshot.userId;
  if (!userId || !isSupabaseConfigured()) return;
  const client = getSupabaseBrowserClient();
  const { data, error } = await client.rpc("ensure_pending_reservation_review_requests");
  if (error) {
    // Quiet — same behavior as the prior in-component handler.
    return;
  }
  const next = normalizeReviewRequests(data as PendingReviewRequestRow[] | null);
  setSnapshot({ ...store.snapshot, requests: next });
  if (next.length > 0) dispatchNotificationsChanged();
}

function dropReservationLocally(reservationId: string) {
  if (!store.snapshot.requests.some((r) => r.reservation_id === reservationId)) return;
  setSnapshot({
    ...store.snapshot,
    requests: store.snapshot.requests.filter((r) => r.reservation_id !== reservationId),
  });
}

function teardown() {
  if (store.channel) {
    void getSupabaseBrowserClient().removeChannel(store.channel);
    store.channel = null;
  }
  if (store.pollTimer !== null) {
    window.clearInterval(store.pollTimer);
    store.pollTimer = null;
  }
  if (store.visibilityListener) {
    document.removeEventListener("visibilitychange", store.visibilityListener);
    store.visibilityListener = null;
  }
  if (store.focusListener) {
    window.removeEventListener("focus", store.focusListener);
    store.focusListener = null;
  }
}

function setupForUser(userId: string) {
  // Clean up any prior wiring for a different user (e.g. account switch).
  if (store.snapshot.userId && store.snapshot.userId !== userId) {
    teardown();
  }
  if (store.snapshot.userId !== userId) {
    setSnapshot({ userId, requests: [], dismissedIds: EMPTY_SET });
  }

  // Initial fetch.
  void refreshFromRpc();

  // 60s poll fallback. Realtime + visibility/focus close the cross-device
  // window much faster, but this is the safety net.
  if (store.pollTimer === null) {
    store.pollTimer = window.setInterval(() => { void refreshFromRpc(); }, REVIEW_REQUEST_CHECK_MS);
  }

  // Refresh when the tab becomes visible or window regains focus. This is
  // what catches the case where mobile submitted a review while this tab
  // was backgrounded.
  if (!store.visibilityListener) {
    store.visibilityListener = () => {
      if (document.visibilityState === "visible") void refreshFromRpc();
    };
    document.addEventListener("visibilitychange", store.visibilityListener);
  }
  if (!store.focusListener) {
    store.focusListener = () => { void refreshFromRpc(); };
    window.addEventListener("focus", store.focusListener);
  }

  // Realtime INSERT subscription on restaurant_reviews, filtered to this
  // user_id. When another device (mobile, another tab) inserts a review,
  // we drop it from local state immediately and refresh to be safe.
  if (!store.channel && isSupabaseConfigured()) {
    const client = getSupabaseBrowserClient();
    // HMR/double-mount safety: supabase-js `client.channel(name)` returns
    // the same instance for the same topic, and `.on()` on an already-
    // subscribed channel throws. Clean up any orphan with this topic first.
    const topic = `realtime:review-requests-self:${userId}`;
    for (const existing of client.getChannels()) {
      if (existing.topic === topic) void client.removeChannel(existing);
    }
    store.channel = client
      .channel(`review-requests-self:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "restaurant_reviews", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { reservation_id?: string | null } | null;
          const rid = row?.reservation_id ?? null;
          if (rid) dropReservationLocally(rid);
          void refreshFromRpc();
        },
      )
      .subscribe();
  }
}

function attach(userId: string | null) {
  store.refcount += 1;
  if (userId) setupForUser(userId);
}

function detach() {
  store.refcount = Math.max(0, store.refcount - 1);
  if (store.refcount === 0) teardown();
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => { store.listeners.delete(listener); };
}

function getSnapshot(): StoreSnapshot {
  return store.snapshot;
}

function getServerSnapshot(): StoreSnapshot {
  // SSR-safe default; this app is SPA-only but tsc strict + useSyncExternalStore
  // requires this signature.
  return { userId: null, requests: [], dismissedIds: EMPTY_SET };
}

function markDismissed(reservationId: string) {
  setDismissedPrompt(reservationId);
  const next = new Set(store.snapshot.dismissedIds);
  next.add(reservationId);
  setSnapshot({ ...store.snapshot, dismissedIds: next });
}

function clearDismissed(reservationId: string) {
  clearDismissedPrompt(reservationId);
  const next = new Set(store.snapshot.dismissedIds);
  next.delete(reservationId);
  setSnapshot({ ...store.snapshot, dismissedIds: next });
}

async function submitRpc(
  reservationId: string,
  rating: number,
  reviewText: string | null,
): Promise<SubmitOutcome> {
  if (!isSupabaseConfigured()) throw new Error("Supabase not configured");
  const client = getSupabaseBrowserClient();
  const { error } = await client.rpc("submit_reservation_review", {
    p_reservation_id: reservationId,
    p_rating: rating,
    p_review_text: reviewText,
  });
  if (error) {
    const msg = error.message ?? "";
    // Race-loser path: another device just inserted a row for this
    // reservation. We treat that as success — the user reviewed it,
    // just not from this tab.
    if (/23505|unique|duplicate|already.*review/i.test(msg)) {
      dropReservationLocally(reservationId);
      dispatchNotificationsChanged();
      return "already-reviewed";
    }
    throw new Error(msg);
  }
  dropReservationLocally(reservationId);
  clearDismissedPrompt(reservationId);
  dispatchNotificationsChanged();
  return "success";
}

export type UseReservationReviewRequests = {
  requests: ReviewRequest[];
  activeRequest: ReviewRequest | null;
  submit: (reservationId: string, rating: number, reviewText: string | null) => Promise<SubmitOutcome>;
  dismiss: (reservationId: string) => void;
  refresh: () => Promise<void>;
  reactivate: (reservationId: string) => void;
};

export function useReservationReviewRequests(): UseReservationReviewRequests {
  const { profile, user } = useUser();
  const userId = profile?.id ?? null;
  const enabled = Boolean(userId && user);

  // Attach/detach a refcounted subscription so the singleton tears down
  // when the LAST consumer unmounts (e.g. user signs out).
  useEffect(() => {
    if (!enabled) return;
    attach(userId);
    return () => { detach(); };
  }, [enabled, userId]);

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // Defense in depth: when no user is signed in, the singleton may still hold
  // requests from a prior session (it doesn't auto-clear on signout). Surface
  // an empty view to every consumer so a stale row can never leak past the
  // auth boundary, regardless of how the consumer mounts itself.
  const requests = enabled ? snapshot.requests : [];

  const activeRequest = useMemo(() => {
    if (!enabled) return null;
    return snapshot.requests.find((req) => (
      !snapshot.dismissedIds.has(req.reservation_id) && !hasDismissedPrompt(req.reservation_id)
    )) ?? null;
  }, [enabled, snapshot.requests, snapshot.dismissedIds]);

  const dismiss = useCallback((reservationId: string) => {
    markDismissed(reservationId);
  }, []);

  const reactivate = useCallback((reservationId: string) => {
    clearDismissed(reservationId);
  }, []);

  const submit = useCallback(submitRpc, []);
  const refresh = useCallback(() => refreshFromRpc(), []);

  return { requests, activeRequest, submit, dismiss, refresh, reactivate };
}

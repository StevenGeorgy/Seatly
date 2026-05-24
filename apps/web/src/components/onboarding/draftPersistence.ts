// Per-step draft persistence for the onboarding wizard.
//
// Wraps sessionStorage so a tab discard / accidental refresh doesn't wipe
// the input on the step the owner is currently typing into. Each step calls
// readDraft() inside its useState initializer to seed the form, then drives
// useDraftAutosave() to push changes back to sessionStorage on a short
// debounce. When the step's Continue succeeds, the caller invokes
// clearDraft() so a stale draft can't shadow a freshly-saved-to-DB value
// the next time the owner returns.
//
// SessionStorage was chosen over localStorage on purpose: drafts should be
// per-tab and ephemeral — surviving Chrome's "tab discard" feature but
// disappearing if the tab is closed entirely or the wizard is finished.

import { useEffect, useRef } from "react";

const DRAFT_PREFIX = "cenaiva.wizard.draft.v1.";
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 300;

type DraftEnvelope<T> = { ts: number; data: T };

function storageKey(key: string): string {
  return `${DRAFT_PREFIX}${key}`;
}

/**
 * Read a draft synchronously. Call inside a useState initializer so the
 * form mounts already populated with the saved values.
 */
export function readDraft<T>(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftEnvelope<T>;
    if (typeof parsed.ts !== "number") return null;
    if (Date.now() - parsed.ts > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/**
 * Auto-save the given value to sessionStorage whenever it changes,
 * debounced so we don't pound storage on every keystroke. Safe to call
 * with enabled=false to opt out (e.g. before a restaurantId is known).
 */
export function useDraftAutosave<T>(
  key: string,
  value: T,
  options: { enabled?: boolean; debounceMs?: number } = {},
): void {
  const { enabled = true, debounceMs = DEFAULT_DEBOUNCE_MS } = options;
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      try {
        const envelope: DraftEnvelope<T> = { ts: Date.now(), data: valueRef.current };
        window.sessionStorage.setItem(storageKey(key), JSON.stringify(envelope));
      } catch {
        // Quota / private-mode failures — fail silently. The user just
        // doesn't get draft persistence on this tab.
      }
    }, debounceMs);
    return () => window.clearTimeout(timer);
  }, [enabled, debounceMs, key, value]);
}

/**
 * Wipe a step's draft. Call after a successful Continue so the DB value
 * is authoritative on the next render and stale draft data can't override
 * it after a navigate-away-and-back.
 */
export function clearDraft(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(key));
  } catch {
    /* noop */
  }
}

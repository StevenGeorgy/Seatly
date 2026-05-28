// useSubmitGuard — minimal hook for "button must stay disabled until the
// in-flight async action is fully processed." Returned `submitting` is
// the disabled-prop value for the trigger button; `guard` wraps the
// async work and blocks re-entry while it's running.
//
// Usage:
//   const { submitting, guard } = useSubmitGuard();
//   <Button onClick={() => guard(handleCancel)} disabled={submitting}>Cancel</Button>
//
// On unmount mid-flight: the flag isn't reset (component is gone anyway),
// but the in-flight promise still runs. Callers that need to abort should
// use AbortController inside their async fn.

import { useCallback, useRef, useState } from "react";

export interface SubmitGuard {
  submitting: boolean;
  /** Run `fn` if not already running. Returns the result, or undefined when blocked. */
  guard: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

export function useSubmitGuard(): SubmitGuard {
  const [submitting, setSubmitting] = useState(false);
  // Ref mirrors state for synchronous re-entry checks. Without this, two
  // rapid clicks in the same tick both pass the `if (submitting) return`
  // check before either setSubmitting(true) has flushed.
  const inFlightRef = useRef(false);

  const guard = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (inFlightRef.current) return undefined;
    inFlightRef.current = true;
    setSubmitting(true);
    try {
      return await fn();
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }, []);

  return { submitting, guard };
}

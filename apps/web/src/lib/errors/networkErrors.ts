import type { UserFacingError } from "./types";

/**
 * Browser fetch failures (TypeError "Failed to fetch"), timeouts, offline.
 */
export function tryMapNetworkError(error: unknown): UserFacingError | null {
  // Offline check
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      code: "offline",
      message: "You're offline. Check your connection and try again.",
      source: "network",
      retryable: true,
      technical: error,
    };
  }

  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return {
      code: "fetch_failed",
      message: "We couldn't reach the server. Check your connection and try again.",
      source: "network",
      retryable: true,
      technical: error,
    };
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    return {
      code: "timeout",
      message: "That took too long. Try again.",
      source: "network",
      retryable: true,
      technical: error,
    };
  }

  return null;
}

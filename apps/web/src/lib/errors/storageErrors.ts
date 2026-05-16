import type { UserFacingError } from "./types";

/**
 * Supabase Storage errors come through with `.statusCode` (string) and a
 * `.name` like `StorageApiError`. Common cases: file too big, mime rejected,
 * RLS denied the upload, bucket missing.
 */

function looksLikeStorageError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const obj = e as { name?: string; __isStorageError?: boolean };
  return (
    obj.__isStorageError === true ||
    obj.name === "StorageApiError" ||
    obj.name === "StorageUnknownError"
  );
}

export function tryMapStorageError(error: unknown): UserFacingError | null {
  if (!looksLikeStorageError(error)) return null;

  const e = error as { message?: string; statusCode?: string; status?: number };
  const msg = (e.message ?? "").toLowerCase();
  const status = Number(e.statusCode ?? e.status ?? 0);

  if (status === 413 || msg.includes("payload too large") || msg.includes("too large")) {
    return {
      code: "file_too_big",
      message: "That file is too big. Pick something under 5 MB.",
      source: "storage",
      retryable: false,
      technical: e,
    };
  }

  if (msg.includes("mime type") || msg.includes("file type")) {
    return {
      code: "wrong_file_type",
      message: "That file type isn't supported. Use JPG, PNG, WebP, or AVIF.",
      source: "storage",
      retryable: false,
      technical: e,
    };
  }

  if (status === 401 || status === 403 || msg.includes("row-level security")) {
    return {
      code: "upload_not_allowed",
      message: "You don't have permission to upload here. Sign in and try again.",
      source: "storage",
      retryable: false,
      technical: e,
    };
  }

  if (status === 404 || msg.includes("not found")) {
    return {
      code: "bucket_missing",
      message: "Couldn't find where to upload this. Refresh and try again.",
      source: "storage",
      retryable: true,
      technical: e,
    };
  }

  return {
    code: "upload_failed",
    message: "Couldn't upload that file. Try again in a moment.",
    source: "storage",
    retryable: true,
    technical: e,
  };
}

/**
 * Pre-upload size check helper for image inputs. Use this BEFORE calling
 * `.upload()` so the friendly message fires without a round-trip.
 */
export const FRIENDLY_UPLOAD_LIMIT_BYTES = 5 * 1024 * 1024;

export function checkFileSize(
  file: File,
  limit = FRIENDLY_UPLOAD_LIMIT_BYTES,
): UserFacingError | null {
  if (file.size <= limit) return null;
  const mb = (limit / (1024 * 1024)).toFixed(0);
  return {
    code: "file_too_big",
    message: `That file is too big. Pick something under ${mb} MB.`,
    source: "storage",
    retryable: false,
  };
}

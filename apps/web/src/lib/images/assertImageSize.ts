import { toast } from "sonner";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
]);

/**
 * Guard for any image upload site that writes to Supabase storage. Rejects
 * files over 5 MB AND files whose declared MIME type isn't a real image
 * format (a .exe renamed to .jpg would have type === "application/octet-
 * stream" or empty, not image/*). Returns false so the caller can bail out.
 */
export function assertImageOk(file: File): boolean {
  const type = (file.type ?? "").toLowerCase();
  if (!type.startsWith("image/") || !ALLOWED_IMAGE_MIME.has(type)) {
    toast.error(
      `That file isn't a supported image. Please upload a JPG, PNG, GIF, WebP, or HEIC photo.`,
    );
    return false;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    toast.error(
      `That photo is ${mb} MB. Please use an image under 5 MB — try compressing it or take a screenshot.`,
    );
    return false;
  }
  return true;
}

/** @deprecated use `assertImageOk` (now also checks MIME type) */
export const assertImageSizeOk = assertImageOk;

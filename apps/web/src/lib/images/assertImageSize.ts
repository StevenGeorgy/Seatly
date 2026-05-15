import { toast } from "sonner";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Guard for any image upload site that writes to Supabase storage. Rejects
 * files over 5 MB with a friendly toast and returns false so the caller can
 * bail out. The cap protects diner page load time (oversized hero images)
 * and platform storage costs.
 */
export function assertImageSizeOk(file: File): boolean {
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    toast.error(
      `That photo is ${mb} MB. Please use an image under 5 MB — try compressing it or take a screenshot.`,
    );
    return false;
  }
  return true;
}

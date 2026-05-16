import { useCallback, useState } from "react";

import type { ExpenseCategory } from "@/hooks/useExpenses";
import { fileToBase64 } from "@/lib/files/fileToBase64";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";

export type ScanReceiptDraft = {
  vendor: string | null;
  expenseDate: string | null;
  amount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  category: ExpenseCategory | null;
  paymentMethod: string | null;
};

export type ScanReceiptErrorCode =
  | "rate_limit_minute"
  | "rate_limit_day"
  | "unauthorized"
  | "vision_failed"
  | "invalid_image"
  | "image_too_large"
  | "supabase_unconfigured"
  | "no_session"
  | "network";

export type ScanReceiptOutcome =
  | {
      ok: true;
      draft: ScanReceiptDraft;
      extractedFields: string[];
      raw: unknown;
    }
  | {
      ok: false;
      code: ScanReceiptErrorCode;
      message: string;
      retryAfter?: number;
    };

// Edge fn caps image_base64 at ~7.5 MB. A binary file × 4/3 ≈ base64 size,
// so 5 MB is the practical safe cap from the client side.
export const SCAN_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SCAN_ALLOWED_MIME = /^image\/(?:jpeg|jpg|png|webp|heic|heif)$/i;

function friendlyMessage(code: ScanReceiptErrorCode): string {
  switch (code) {
    case "rate_limit_minute":
      return "Too many scans in a row. Try again in about a minute.";
    case "rate_limit_day":
      return "Daily AI scan limit reached. Fill in the receipt manually for now.";
    case "unauthorized":
    case "no_session":
      return "Sign in again to use receipt scanning.";
    case "vision_failed":
      return "Couldn't read this receipt. Fill in the fields manually.";
    case "invalid_image":
      return "Unsupported image format for AI scanning.";
    case "image_too_large":
      return "Image is too large for AI scanning (5 MB max).";
    case "supabase_unconfigured":
      return "Receipt scanning is unavailable right now.";
    case "network":
      return "Couldn't reach the scanning service. Check your connection.";
  }
}

export function useScanReceipt() {
  const [loading, setLoading] = useState(false);

  const scan = useCallback(async (file: File, mime: string): Promise<ScanReceiptOutcome> => {
    if (!isSupabaseConfigured()) {
      return { ok: false, code: "supabase_unconfigured", message: friendlyMessage("supabase_unconfigured") };
    }
    if (!SCAN_ALLOWED_MIME.test(mime)) {
      return { ok: false, code: "invalid_image", message: friendlyMessage("invalid_image") };
    }
    if (file.size > SCAN_MAX_IMAGE_BYTES) {
      return { ok: false, code: "image_too_large", message: friendlyMessage("image_too_large") };
    }

    setLoading(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token ?? null;
      if (!token) {
        return { ok: false, code: "no_session", message: friendlyMessage("no_session") };
      }

      const imageBase64 = await fileToBase64(file);

      // Raw fetch (not client.functions.invoke) so we can read body.error on
      // 429/4xx responses; functions.invoke wraps non-2xx as a generic error
      // and discards the JSON body.
      const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/scan-receipt`, {
        method: "POST",
        headers: {
          apikey: getSupabaseAnonKey(),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image_base64: imageBase64, image_mime_type: mime }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        draft?: ScanReceiptDraft;
        extractedFields?: string[];
        aiRaw?: unknown;
        error?: string;
        message?: string;
        retry_after?: number;
      };

      if (!res.ok || body.error) {
        const code = body.error ?? "vision_failed";
        if (code === "rate_limit_minute" || code === "rate_limit_day") {
          return {
            ok: false,
            code,
            message: friendlyMessage(code),
            retryAfter: typeof body.retry_after === "number" ? body.retry_after : undefined,
          };
        }
        if (code === "unauthorized") {
          return { ok: false, code: "unauthorized", message: friendlyMessage("unauthorized") };
        }
        return {
          ok: false,
          code: "vision_failed",
          message: body.message ?? friendlyMessage("vision_failed"),
        };
      }

      if (!body.draft) {
        return { ok: false, code: "vision_failed", message: friendlyMessage("vision_failed") };
      }

      return {
        ok: true,
        draft: body.draft,
        extractedFields: body.extractedFields ?? [],
        raw: body.aiRaw,
      };
    } catch {
      return { ok: false, code: "network", message: friendlyMessage("network") };
    } finally {
      setLoading(false);
    }
  }, []);

  return { scan, loading };
}

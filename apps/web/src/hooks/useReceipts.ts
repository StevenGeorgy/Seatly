import { useCallback, useEffect, useMemo, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import { toUserFacingError } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ReceiptFileType = "image" | "pdf";
export type ReceiptTransactionType = "expense" | "income";

export type ReceiptRow = {
  id: string;
  restaurant_id: string;
  uploaded_by: string | null;
  expense_id: string | null;
  transaction_type: ReceiptTransactionType | null;
  file_path: string;
  file_name: string;
  file_type: ReceiptFileType;
  file_size: number | null;
  description: string | null;
  receipt_date: string | null;
  amount: number | null;
  currency: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type ReceiptWithUrl = ReceiptRow & { signed_url: string | null };

export type ReceiptFilters = {
  transactionType?: ReceiptTransactionType;
  dateFrom?: string;
  dateTo?: string;
};

export type CreateReceiptPayload = {
  file: File;
  transaction_type?: ReceiptTransactionType | null;
  description?: string | null;
  receipt_date?: string | null;
  expense_id?: string | null;
  amount?: number | null;
  currency?: string | null;
};

export type UpdateReceiptPayload = {
  transaction_type?: ReceiptTransactionType | null;
  description?: string | null;
  receipt_date?: string | null;
  expense_id?: string | null;
  amount?: number | null;
  currency?: string | null;
};

export type CreateReceiptResult =
  | { error: string; receiptId?: undefined }
  | {
      error?: undefined;
      receiptId: string | null;
      filePath: string;
      fileType: ReceiptFileType;
      mime: string;
    };

const SUPPORTED_RECEIPT_TYPES: Array<{
  kind: ReceiptFileType;
  mime: string;
  extensions: string[];
}> = [
  { kind: "image", mime: "image/jpeg", extensions: ["jpg", "jpeg"] },
  { kind: "image", mime: "image/png", extensions: ["png"] },
  { kind: "image", mime: "image/webp", extensions: ["webp"] },
  { kind: "image", mime: "image/gif", extensions: ["gif"] },
  { kind: "image", mime: "image/avif", extensions: ["avif"] },
  { kind: "image", mime: "image/heic", extensions: ["heic"] },
  { kind: "image", mime: "image/heif", extensions: ["heif"] },
  { kind: "pdf", mime: "application/pdf", extensions: ["pdf"] },
];

export const RECEIPT_ACCEPT = SUPPORTED_RECEIPT_TYPES
  .flatMap((type) => [type.mime, ...type.extensions.map((ext) => `.${ext}`)])
  .join(",");

export const RECEIPT_SUPPORT_MESSAGE = "Upload a JPG, PNG, WebP, GIF, AVIF, HEIC, HEIF, or PDF file.";
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export function resolveReceiptKind(file: File): { kind: ReceiptFileType; mime: string } | null {
  const mime = file.type.toLowerCase();
  const byMime = SUPPORTED_RECEIPT_TYPES.find((type) => type.mime === mime);
  if (byMime) return { kind: byMime.kind, mime: byMime.mime };

  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension) return null;

  const byExtension = SUPPORTED_RECEIPT_TYPES.find((type) => type.extensions.includes(extension));
  return byExtension ? { kind: byExtension.kind, mime: byExtension.mime } : null;
}

const SIGNED_URL_TTL_SECONDS = 60 * 60;

export function useReceipts(filters?: ReceiptFilters) {
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const { profile } = useUser();
  const [receipts, setReceipts] = useState<ReceiptWithUrl[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const currency = selectedRestaurant?.currency ?? "cad";

  const transactionTypeFilter = filters?.transactionType;
  const dateFromFilter = filters?.dateFrom;
  const dateToFilter = filters?.dateTo;

  const signReceipt = useCallback(async (row: ReceiptRow): Promise<string | null> => {
    if (!isSupabaseConfigured()) return null;
    const client = getSupabaseBrowserClient();
    const { data, error: signError } = await client.storage
      .from("receipts")
      .createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS);
    if (signError) return null;
    return data?.signedUrl ?? null;
  }, []);

  const fetchReceipts = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setReceipts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("receipts")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (transactionTypeFilter) query = query.eq("transaction_type", transactionTypeFilter);
    if (dateFromFilter) query = query.gte("receipt_date", dateFromFilter);
    if (dateToFilter) query = query.lte("receipt_date", dateToFilter);

    const { data, error: queryError } = await query;
    if (queryError) {
      const friendly = toUserFacingError(queryError, "Couldn't load receipts.");
      setError(new Error(friendly.message));
      console.error("[useReceipts.fetch]", friendly.code, friendly.technical ?? queryError);
      setReceipts([]);
      setLoading(false);
      return;
    }

    const rows = (data ?? []) as ReceiptRow[];
    const withUrls = await Promise.all(
      rows.map(async (row) => ({ ...row, signed_url: await signReceipt(row) })),
    );
    setReceipts(withUrls);
    setLoading(false);
  }, [dateFromFilter, dateToFilter, selectedRestaurantId, signReceipt, transactionTypeFilter]);

  useEffect(() => {
    void fetchReceipts();
  }, [fetchReceipts]);

  const createReceipt = useCallback(async (payload: CreateReceiptPayload): Promise<CreateReceiptResult> => {
    if (!selectedRestaurantId) return { error: "No restaurant selected." };
    if (!profile?.id) return { error: "Could not identify the current user profile." };
    if (!isSupabaseConfigured()) return { error: "Supabase not configured." };

    const kind = resolveReceiptKind(payload.file);
    if (!kind) return { error: RECEIPT_SUPPORT_MESSAGE };
    if (payload.file.size > RECEIPT_MAX_BYTES) return { error: "File is larger than 10MB." };

    setSaving(true);
    const client = getSupabaseBrowserClient();
    const safeName = payload.file.name.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
    const filePath = `${selectedRestaurantId}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await client.storage
      .from("receipts")
      .upload(filePath, payload.file, {
        cacheControl: "3600",
        contentType: kind.mime,
        upsert: false,
      });

    if (uploadError) {
      setSaving(false);
      const friendly = toUserFacingError(uploadError, "Couldn't upload the receipt.");
      console.error("[useReceipts.upload]", friendly.code, friendly.technical ?? uploadError);
      return { error: friendly.message };
    }

    const insertPayload = {
      restaurant_id: selectedRestaurantId,
      uploaded_by: profile.id,
      expense_id: payload.expense_id ?? null,
      transaction_type: payload.transaction_type ?? null,
      file_path: filePath,
      file_name: payload.file.name,
      file_type: kind.kind,
      file_size: payload.file.size,
      description: payload.description ?? null,
      receipt_date: payload.receipt_date ?? null,
      amount: payload.amount ?? null,
      currency: payload.currency ?? currency,
    };

    const { data: inserted, error: insertError } = await client
      .from("receipts")
      .insert(insertPayload)
      .select("id, file_path")
      .single();
    setSaving(false);

    if (insertError) {
      await client.storage.from("receipts").remove([filePath]);
      const friendly = toUserFacingError(insertError, "Couldn't save the receipt.");
      console.error("[useReceipts.insert]", friendly.code, friendly.technical ?? insertError);
      return { error: friendly.message };
    }

    await fetchReceipts();
    const row = inserted as { id: string; file_path: string } | null;
    return {
      receiptId: row?.id ?? null,
      filePath: row?.file_path ?? filePath,
      fileType: kind.kind,
      mime: kind.mime,
    };
  }, [currency, fetchReceipts, profile?.id, selectedRestaurantId]);

  const updateReceipt = useCallback(async (id: string, payload: UpdateReceiptPayload): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";

    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error: updateError } = await client
      .from("receipts")
      .update({
        transaction_type: payload.transaction_type ?? null,
        description: payload.description ?? null,
        receipt_date: payload.receipt_date ?? null,
        expense_id: payload.expense_id ?? null,
        amount: payload.amount ?? null,
        currency: payload.currency ?? null,
      })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    setSaving(false);
    if (updateError) {
      const friendly = toUserFacingError(updateError, "Couldn't update the receipt.");
      console.error("[useReceipts.update]", friendly.code, friendly.technical ?? updateError);
      return friendly.message;
    }
    await fetchReceipts();
    return null;
  }, [fetchReceipts, selectedRestaurantId]);

  const deleteReceipt = useCallback(async (id: string): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";

    const target = receipts.find((row) => row.id === id);
    setSaving(true);
    const client = getSupabaseBrowserClient();

    const { error: updateError } = await client
      .from("receipts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    if (updateError) {
      setSaving(false);
      const friendly = toUserFacingError(updateError, "Couldn't delete the receipt.");
      console.error("[useReceipts.delete]", friendly.code, friendly.technical ?? updateError);
      return friendly.message;
    }

    if (target?.file_path) {
      await client.storage.from("receipts").remove([target.file_path]);
    }

    setSaving(false);
    await fetchReceipts();
    return null;
  }, [fetchReceipts, receipts, selectedRestaurantId]);

  const refreshSignedUrl = useCallback(async (id: string): Promise<string | null> => {
    const target = receipts.find((row) => row.id === id);
    if (!target) return null;
    const url = await signReceipt(target);
    if (url) {
      setReceipts((current) =>
        current.map((row) => (row.id === id ? { ...row, signed_url: url } : row)),
      );
    }
    return url;
  }, [receipts, signReceipt]);

  return useMemo(
    () => ({
      receipts,
      loading,
      saving,
      error,
      refetch: fetchReceipts,
      createReceipt,
      updateReceipt,
      deleteReceipt,
      refreshSignedUrl,
    }),
    [createReceipt, deleteReceipt, error, fetchReceipts, loading, receipts, refreshSignedUrl, saving, updateReceipt],
  );
}

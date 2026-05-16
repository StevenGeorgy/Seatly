import { useEffect, useMemo, useRef, useState } from "react";
import { format, isValid, parse } from "date-fns";
import { motion } from "framer-motion";
import {
  Download,
  ExternalLink,
  Eye,
  FileText,
  ImageIcon,
  Pencil,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  RECEIPT_ACCEPT,
  RECEIPT_SUPPORT_MESSAGE,
  resolveReceiptKind,
  useReceipts,
  type ReceiptTransactionType,
  type ReceiptWithUrl,
} from "@/hooks/useReceipts";
import {
  useExpenses,
  type ExpenseRow,
} from "@/hooks/useExpenses";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  SCAN_MAX_IMAGE_BYTES,
  useScanReceipt,
  type ScanReceiptDraft,
} from "@/hooks/useScanReceipt";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import {
  ReceiptScanReviewDialog,
  type ReceiptScanReviewSubmit,
} from "@/components/dashboard/ReceiptScanReviewDialog";
import { useErrorToast } from "@/lib/errors";

const TRANSACTION_FILTERS: Array<{ value: "all" | ReceiptTransactionType; label: string }> = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "income", label: "Income" },
];

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readableDate(date: string | null | undefined): string {
  if (!date) return "—";
  const parsed = parse(date, "yyyy-MM-dd", new Date());
  if (!isValid(parsed)) return date;
  return format(parsed, "MMM d, yyyy");
}

function readableTimestamp(date: string | null | undefined): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return format(parsed, "MMM d, yyyy · h:mm a");
}

function transactionLabel(type: ReceiptTransactionType | null | undefined): string {
  if (type === "income") return "Income";
  if (type === "expense") return "Expense";
  return "Unfiled";
}

const CATEGORY_LABELS: Record<string, string> = {
  food_cost: "Food cost",
  food_supplies: "Food supplies",
  beverages: "Beverages",
  utilities: "Utilities",
  rent: "Rent",
  equipment: "Equipment",
  marketing: "Marketing",
  staff: "Staff",
  supplies: "Supplies",
  maintenance: "Maintenance",
  cleaning: "Cleaning",
  sales: "Sales",
  preorders: "Pre-orders",
  events: "Events",
  catering: "Catering",
  delivery: "Delivery",
  gift_cards: "Gift cards",
  other: "Other",
};

function categoryLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return CATEGORY_LABELS[value] ?? value;
}

type ReceiptDetailsPanelProps = {
  receipt: ReceiptWithUrl | null;
  expense: ExpenseRow | null;
  loading: boolean;
  fallbackCurrency: string;
};

function ReceiptDetailsPanel({ receipt, expense, loading, fallbackCurrency }: ReceiptDetailsPanelProps) {
  if (!receipt) return null;
  const expenseCurrency = expense?.currency || receipt.currency || fallbackCurrency;
  const aiBlob = (expense?.ai_extracted_data ?? null) as Record<string, unknown> | null;
  const paymentMethodRaw = aiBlob && typeof aiBlob.payment_method === "string" ? aiBlob.payment_method : null;
  const hasExpense = expense !== null;

  return (
    <aside className="flex flex-col gap-4 overflow-y-auto border-l border-border bg-bg-surface/40 px-5 py-5">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Details</h3>
          {expense?.ai_categorized && (
            <Badge className="gap-1 border border-gold/40 bg-gold/10 px-1.5 py-0 text-[9px] font-mono uppercase tracking-wider text-gold">
              <Sparkles className="size-2.5" /> AI scanned
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          {hasExpense
            ? "Fields extracted from this receipt and saved to the expense."
            : loading
              ? "Loading details…"
              : "This receipt isn't linked to an expense yet. Tap the pencil to add details."}
        </p>
      </div>

      <dl className="grid gap-3 text-sm">
        <DetailRow label="Vendor" value={expense?.vendor_name ?? receipt.description ?? "—"} />
        <DetailRow label="Type" value={transactionLabel(receipt.transaction_type)} />
        <DetailRow label="Category" value={categoryLabel(expense?.category)} />
        <DetailRow label="Receipt date" value={readableDate(expense?.expense_date ?? receipt.receipt_date)} />
        <DetailRow
          label="Subtotal"
          value={
            expense?.amount != null
              ? formatCurrency(expense.amount, expenseCurrency)
              : receipt.amount != null
                ? formatCurrency(receipt.amount, expenseCurrency)
                : "—"
          }
        />
        <DetailRow
          label="Tax"
          value={
            expense?.tax_amount != null
              ? formatCurrency(expense.tax_amount, expenseCurrency)
              : "—"
          }
        />
        <DetailRow
          label="Total"
          value={
            expense?.total_amount != null
              ? formatCurrency(expense.total_amount, expenseCurrency)
              : receipt.amount != null
                ? formatCurrency(receipt.amount, expenseCurrency)
                : "—"
          }
          emphasis
        />
        <DetailRow label="Currency" value={(expenseCurrency || "").toUpperCase() || "—"} />
        <DetailRow label="Payment method" value={paymentMethodRaw ?? "—"} />
        {expense?.notes && <DetailRow label="Notes" value={expense.notes} multiline />}
      </dl>
    </aside>
  );
}

function DetailRow({
  label,
  value,
  emphasis,
  multiline,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{label}</dt>
      <dd
        className={cn(
          multiline ? "whitespace-pre-wrap break-words text-text-secondary" : "truncate text-text-secondary",
          emphasis && "font-mono text-base text-white",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

type ReceiptsLibraryProps = {
  currency: string;
  rangeCaption: string;
  filterDateFrom?: string | null;
  filterDateTo?: string | null;
  onExpenseSaved?: (expenseDate: string | null) => void;
};

type EditState = {
  receipt: ReceiptWithUrl;
  transaction_type: ReceiptTransactionType | "unfiled";
  description: string;
  receipt_date: string;
  amount: string;
};

type ScanReview = {
  receiptId: string;
  fileName: string;
  mime: string;
  isImage: boolean;
  filePreviewUrl: string | null;
  draft: ScanReceiptDraft | null;
  extractedFields: string[];
};

export function ReceiptsLibrary({
  currency,
  rangeCaption,
  filterDateFrom,
  filterDateTo,
  onExpenseSaved,
}: ReceiptsLibraryProps) {
  const { receipts, loading, saving, createReceipt, updateReceipt, deleteReceipt, refreshSignedUrl } = useReceipts();
  const { createExpense, saving: savingExpense } = useExpenses();
  const { scan } = useScanReceipt();
  const { errorToast } = useErrorToast();
  const [transactionFilter, setTransactionFilter] = useState<"all" | ReceiptTransactionType>("all");
  const [previewTarget, setPreviewTarget] = useState<ReceiptWithUrl | null>(null);
  const [editTarget, setEditTarget] = useState<EditState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReceiptWithUrl | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [scanReview, setScanReview] = useState<ScanReview | null>(null);
  const [previewExpense, setPreviewExpense] = useState<ExpenseRow | null>(null);
  const [previewExpenseLoading, setPreviewExpenseLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    if (transactionFilter === "all") return receipts;
    return receipts.filter((row) => row.transaction_type === transactionFilter);
  }, [receipts, transactionFilter]);

  const totals = useMemo(() => {
    const counts = { all: receipts.length, expense: 0, income: 0, unfiled: 0 };
    for (const row of receipts) {
      if (row.transaction_type === "expense") counts.expense += 1;
      else if (row.transaction_type === "income") counts.income += 1;
      else counts.unfiled += 1;
    }
    return counts;
  }, [receipts]);

  useEffect(() => {
    if (!previewTarget) return;
    if (previewTarget.signed_url) return;
    void refreshSignedUrl(previewTarget.id).then((url) => {
      if (url) setPreviewTarget((current) => (current ? { ...current, signed_url: url } : current));
    });
  }, [previewTarget, refreshSignedUrl]);

  useEffect(() => {
    if (!previewTarget) {
      setPreviewExpense(null);
      setPreviewExpenseLoading(false);
      return;
    }
    if (!previewTarget.expense_id || !isSupabaseConfigured()) {
      setPreviewExpense(null);
      return;
    }
    let cancelled = false;
    setPreviewExpenseLoading(true);
    const client = getSupabaseBrowserClient();
    void client
      .from("expenses")
      .select("*")
      .eq("id", previewTarget.expense_id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPreviewExpense((data as ExpenseRow | null) ?? null);
        setPreviewExpenseLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [previewTarget]);

  const uploadFile = async (file: File) => {
    const kind = resolveReceiptKind(file);
    if (!kind) {
      toast.error(RECEIPT_SUPPORT_MESSAGE);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const result = await createReceipt({ file, currency });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (result.error) {
      errorToast(result.error, { fallback: result.error, logTag: "[ReceiptsLibrary.upload]" });
      return;
    }
    setUploadOpen(false);

    const isScanEligible =
      kind.kind === "image" &&
      file.size <= SCAN_MAX_IMAGE_BYTES &&
      /^image\/(?:jpeg|jpg|png|webp|heic|heif)$/i.test(kind.mime);

    if (!isScanEligible || !result.receiptId) {
      if (kind.kind === "pdf") {
        toast.success("Receipt uploaded. PDFs aren't auto-scanned — tap edit to add details.");
      } else if (file.size > SCAN_MAX_IMAGE_BYTES) {
        toast.success("Receipt uploaded. Image is too large for AI scan — tap edit to add details.");
      } else {
        toast.success("Receipt uploaded.");
      }
      return;
    }

    // Kick off AI scan in the background; show the review modal regardless of
    // outcome so the user can still confirm/edit fields.
    const previewableMime = /^image\/(?:jpeg|jpg|png|webp)$/i.test(kind.mime);
    const localPreview = previewableMime ? URL.createObjectURL(file) : null;
    toast.message("Scanning receipt with AI…");
    const outcome = await scan(file, kind.mime);
    if (!outcome.ok) {
      errorToast(outcome.message, { fallback: outcome.message, logTag: "[ReceiptsLibrary.scan]" });
      setScanReview({
        receiptId: result.receiptId,
        fileName: file.name,
        mime: kind.mime,
        isImage: previewableMime,
        filePreviewUrl: localPreview,
        draft: null,
        extractedFields: [],
      });
      return;
    }
    setScanReview({
      receiptId: result.receiptId,
      fileName: file.name,
      mime: kind.mime,
      isImage: previewableMime,
      filePreviewUrl: localPreview,
      draft: outcome.draft,
      extractedFields: outcome.extractedFields,
    });
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) void uploadFile(file);
  };

  const submitEdit = async () => {
    if (!editTarget) return;
    const amountValue = editTarget.amount ? Number(editTarget.amount) : null;
    const result = await updateReceipt(editTarget.receipt.id, {
      transaction_type: editTarget.transaction_type === "unfiled" ? null : editTarget.transaction_type,
      description: editTarget.description || null,
      receipt_date: editTarget.receipt_date || null,
      amount: amountValue !== null && Number.isFinite(amountValue) ? amountValue : null,
      currency,
    });
    if (result) {
      errorToast(result, { fallback: result, logTag: "[ReceiptsLibrary.submitEdit]" });
      return;
    }
    toast.success("Receipt updated.");
    setEditTarget(null);
  };

  const closeScanReview = () => {
    if (scanReview?.filePreviewUrl) URL.revokeObjectURL(scanReview.filePreviewUrl);
    setScanReview(null);
  };

  const submitScanReview = async (values: ReceiptScanReviewSubmit) => {
    if (!scanReview) return;
    const createResult = await createExpense({
      transaction_type: values.transaction_type,
      category: values.category,
      vendor_name: values.vendor_name,
      description: scanReview.fileName,
      notes: values.notes,
      amount: values.amount,
      tax_amount: values.tax_amount,
      total_amount: values.total_amount,
      currency: values.currency,
      expense_date: values.expense_date,
      payment_status: "paid",
      frequency: "one_time",
      ai_categorized: true,
      ai_extracted_data: {
        vendor: values.vendor_name,
        category: values.category,
        amount: values.amount,
        tax_amount: values.tax_amount,
        total_amount: values.total_amount,
        currency: values.currency,
        expense_date: values.expense_date,
        payment_method: values.payment_method,
        transaction_type: values.transaction_type,
        scan_extracted_fields: scanReview.extractedFields,
      },
    });
    if (createResult.error) {
      errorToast(createResult.error, {
        fallback: createResult.error,
        logTag: "[ReceiptsLibrary.submitScanReview]",
      });
      return;
    }

    const linkError = await updateReceipt(scanReview.receiptId, {
      transaction_type: values.transaction_type === "income" ? "income" : "expense",
      description: values.vendor_name,
      receipt_date: values.expense_date,
      amount: values.total_amount,
      currency: values.currency,
      expense_id: createResult.id,
    });

    onExpenseSaved?.(values.expense_date);

    const outsideRange =
      values.expense_date &&
      ((filterDateFrom && values.expense_date < filterDateFrom) ||
        (filterDateTo && values.expense_date > filterDateTo));

    if (linkError) {
      toast.message("Expense saved. Couldn't refresh the receipt row — refresh to see it.");
    } else if (outsideRange) {
      toast.success(`${values.transaction_type === "income" ? "Income" : "Expense"} added for ${values.expense_date}. Date range expanded so it shows up in Entries.`);
    } else {
      toast.success(`Receipt scanned and ${values.transaction_type === "income" ? "income" : "expense"} added.`);
    }
    closeScanReview();
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteReceipt(deleteTarget.id);
    if (result) {
      errorToast(result, { fallback: result, logTag: "[ReceiptsLibrary.submitDelete]" });
      return;
    }
    toast.success("Receipt removed.");
    setDeleteTarget(null);
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-bg-surface p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
        <div className="flex flex-wrap items-center gap-2">
          {TRANSACTION_FILTERS.map((option) => {
            const count = option.value === "all" ? totals.all : totals[option.value];
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTransactionFilter(option.value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                  transactionFilter === option.value
                    ? "border-gold/40 bg-gold/10 text-gold"
                    : "border-border bg-bg-elevated/40 text-text-muted hover:text-text-secondary",
                )}
              >
                {option.label}
                <span className="font-mono text-[10px] text-text-muted">{count}</span>
              </button>
            );
          })}
          {totals.unfiled > 0 && transactionFilter !== "all" && (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
              {totals.unfiled} unfiled
            </span>
          )}
        </div>
        <Button size="default" className="gap-2" onClick={() => setUploadOpen(true)}>
          <Upload className="size-4" />
          Upload receipt
        </Button>
      </div>

      <article className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
        <div className="flex items-start justify-between gap-4 px-5 py-5 lg:px-6">
          <div>
            <h2 className="font-serif text-2xl text-white">Receipts library</h2>
            <p className="mt-1 text-xs text-text-muted">
              {filtered.length} receipt{filtered.length === 1 ? "" : "s"} · stored securely · {rangeCaption}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead>
              <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                <th className="px-5 py-3 font-medium lg:px-6">Preview</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Description</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 text-right font-medium lg:px-6">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading && (
                <tr>
                  <td className="px-5 py-8 text-sm text-text-muted lg:px-6" colSpan={7}>
                    Loading receipts...
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td className="px-5 py-8 text-sm text-text-muted lg:px-6" colSpan={7}>
                    No receipts uploaded yet. Drop a file above or click <span className="text-text-secondary">Upload receipt</span>.
                  </td>
                </tr>
              )}
              {!loading && filtered.map((row) => (
                <tr key={row.id} className="text-sm transition-colors hover:bg-bg-elevated/30">
                  <td className="px-5 py-4 lg:px-6">
                    <button
                      type="button"
                      onClick={() => setPreviewTarget(row)}
                      className="flex size-12 items-center justify-center rounded-md border border-border bg-bg-elevated/60 transition-colors hover:border-gold/40 hover:bg-gold/10"
                      aria-label={`Preview ${row.file_name}`}
                    >
                      {row.file_type === "image" && row.signed_url ? (
                        <img
                          src={row.signed_url}
                          alt={row.file_name}
                          className="size-full rounded-md object-cover"
                          loading="lazy"
                        />
                      ) : row.file_type === "image" ? (
                        <ImageIcon className="size-5 text-text-muted" />
                      ) : (
                        <FileText className="size-5 text-gold" />
                      )}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <div className="text-text-primary">{row.file_name}</div>
                    <div className="font-mono text-[10px] uppercase tracking-wider text-text-muted">
                      {row.file_type.toUpperCase()} · {formatBytes(row.file_size)} · uploaded {readableTimestamp(row.created_at)}
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                        row.transaction_type === "income"
                          ? "border-success/30 bg-success/10 text-success"
                          : row.transaction_type === "expense"
                            ? "border-gold/30 bg-gold/10 text-gold"
                            : "border-border bg-bg-elevated/60 text-text-muted",
                      )}
                    >
                      {transactionLabel(row.transaction_type)}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-text-secondary">{row.description || "—"}</td>
                  <td className="px-5 py-4 text-text-secondary">{readableDate(row.receipt_date)}</td>
                  <td className="px-5 py-4 text-right font-mono text-text-primary">
                    {row.amount != null ? formatCurrency(row.amount, row.currency || currency) : "—"}
                  </td>
                  <td className="px-5 py-4 text-right lg:px-6">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-text-muted hover:text-white"
                        onClick={() => setPreviewTarget(row)}
                        aria-label="Preview receipt"
                      >
                        <Eye className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-text-muted hover:text-white"
                        onClick={() =>
                          setEditTarget({
                            receipt: row,
                            transaction_type: row.transaction_type ?? "unfiled",
                            description: row.description ?? "",
                            receipt_date: row.receipt_date ?? "",
                            amount: row.amount != null ? String(row.amount) : "",
                          })
                        }
                        aria-label="Edit receipt"
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-text-muted hover:text-danger"
                        onClick={() => setDeleteTarget(row)}
                        aria-label="Delete receipt"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <Dialog open={uploadOpen} onOpenChange={(open) => setUploadOpen(open)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-bg-base text-text-primary sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Upload receipt</DialogTitle>
            <DialogDescription>PDF or image up to 10MB.</DialogDescription>
          </DialogHeader>

          <input
            ref={fileInputRef}
            type="file"
            accept={RECEIPT_ACCEPT}
            className="sr-only"
            onChange={(event) => handleFiles(event.target.files)}
          />
          <button
            type="button"
            disabled={saving}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              handleFiles(event.dataTransfer.files);
            }}
            className={cn(
              "flex min-h-44 w-full flex-col items-center justify-center rounded-2xl border border-dashed bg-bg-surface/50 px-4 py-8 text-center transition-colors hover:border-gold/40",
              dragOver ? "border-gold/60 bg-gold/5" : "border-border",
              saving && "opacity-60",
            )}
          >
            <Upload className={cn("size-9", saving ? "text-text-muted" : "text-gold")} />
            <span className="mt-3 text-sm font-medium text-white">
              {saving ? "Uploading..." : "Drag image or PDF here"}
            </span>
            <span className="mt-1 text-xs text-text-muted">
              Supports screenshots, AVIF, HEIC, WebP, GIF, and PDF.
            </span>
          </button>
        </DialogContent>
      </Dialog>

      <ReceiptScanReviewDialog
        open={scanReview !== null}
        draft={scanReview?.draft ?? null}
        extractedFields={scanReview?.extractedFields ?? []}
        fileName={scanReview?.fileName ?? ""}
        filePreviewUrl={scanReview?.filePreviewUrl ?? null}
        isImagePreviewable={scanReview?.isImage ?? false}
        defaultCurrency={currency}
        saving={savingExpense || saving}
        onCancel={closeScanReview}
        onConfirm={submitScanReview}
      />

      <Dialog open={previewTarget !== null} onOpenChange={(open) => !open && setPreviewTarget(null)}>
        <DialogContent className="max-h-[92vh] overflow-hidden border-border bg-bg-base p-0 text-text-primary sm:max-w-5xl">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle className="truncate font-serif text-xl">
              {previewTarget?.file_name ?? "Receipt"}
            </DialogTitle>
            <DialogDescription>
              {previewTarget
                ? `${previewTarget.file_type.toUpperCase()} · ${formatBytes(previewTarget.file_size)} · uploaded ${readableTimestamp(previewTarget.created_at)}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-0 overflow-hidden md:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
            <div className="max-h-[70vh] overflow-auto bg-bg-elevated/40">
              {previewTarget?.signed_url ? (
                previewTarget.file_type === "image" ? (
                  <img
                    src={previewTarget.signed_url}
                    alt={previewTarget.file_name}
                    className="mx-auto block max-h-[70vh] w-auto object-contain"
                  />
                ) : (
                  <iframe
                    src={previewTarget.signed_url}
                    title={previewTarget.file_name}
                    className="h-[70vh] w-full"
                  />
                )
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-text-muted">
                  Generating secure preview link...
                </div>
              )}
            </div>
            <ReceiptDetailsPanel
              receipt={previewTarget}
              expense={previewExpense}
              loading={previewExpenseLoading}
              fallbackCurrency={currency}
            />
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {previewTarget?.signed_url && (
              <>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={previewTarget.signed_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                    Open
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-2">
                  <a href={previewTarget.signed_url} download={previewTarget.file_name}>
                    <Download className="size-3.5" />
                    Download
                  </a>
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editTarget !== null} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-bg-base text-text-primary sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Edit receipt</DialogTitle>
            <DialogDescription>Update tagging, dates, and notes for this receipt.</DialogDescription>
          </DialogHeader>
          {editTarget && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tag as</Label>
                  <Select
                    value={editTarget.transaction_type}
                    onValueChange={(value) =>
                      setEditTarget((current) =>
                        current ? { ...current, transaction_type: value as EditState["transaction_type"] } : current,
                      )
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                      <SelectItem value="unfiled">Unfiled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-receipt-date">Receipt date</Label>
                  <Input
                    id="edit-receipt-date"
                    type="date"
                    value={editTarget.receipt_date}
                    onChange={(event) =>
                      setEditTarget((current) =>
                        current ? { ...current, receipt_date: event.target.value } : current,
                      )
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-receipt-amount">Amount</Label>
                <Input
                  id="edit-receipt-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={editTarget.amount}
                  onChange={(event) =>
                    setEditTarget((current) =>
                      current ? { ...current, amount: event.target.value } : current,
                    )
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-receipt-description">Description</Label>
                <Textarea
                  id="edit-receipt-description"
                  rows={3}
                  value={editTarget.description}
                  onChange={(event) =>
                    setEditTarget((current) =>
                      current ? { ...current, description: event.target.value } : current,
                    )
                  }
                />
              </div>
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setEditTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void submitEdit()} disabled={saving}>
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="border-border bg-bg-base text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">Delete receipt?</DialogTitle>
            <DialogDescription>
              This removes the receipt from your library and deletes the stored file.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-xl border border-border bg-bg-surface p-4">
              <p className="text-sm font-medium text-white">{deleteTarget.file_name}</p>
              <p className="mt-1 text-xs text-text-muted">
                {deleteTarget.file_type.toUpperCase()} · {formatBytes(deleteTarget.file_size)} · uploaded {readableTimestamp(deleteTarget.created_at)}
              </p>
            </div>
          )}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void submitDelete()} disabled={saving}>
              {saving ? "Deleting..." : "Delete receipt"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.section>
  );
}

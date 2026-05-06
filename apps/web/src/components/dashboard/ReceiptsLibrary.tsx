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
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

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
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

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

type ReceiptsLibraryProps = {
  currency: string;
  rangeCaption: string;
};

type EditState = {
  receipt: ReceiptWithUrl;
  transaction_type: ReceiptTransactionType | "unfiled";
  description: string;
  receipt_date: string;
  amount: string;
};

export function ReceiptsLibrary({ currency, rangeCaption }: ReceiptsLibraryProps) {
  const { receipts, loading, saving, createReceipt, updateReceipt, deleteReceipt, refreshSignedUrl } = useReceipts();
  const [transactionFilter, setTransactionFilter] = useState<"all" | ReceiptTransactionType>("all");
  const [previewTarget, setPreviewTarget] = useState<ReceiptWithUrl | null>(null);
  const [editTarget, setEditTarget] = useState<EditState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReceiptWithUrl | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
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

  const uploadFile = async (file: File) => {
    const kind = resolveReceiptKind(file);
    if (!kind) {
      toast.error(RECEIPT_SUPPORT_MESSAGE);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    const result = await createReceipt({ file, currency });
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (result) {
      toast.error(result);
      return;
    }
    toast.success("Receipt uploaded.");
    setUploadOpen(false);
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
      toast.error(result);
      return;
    }
    toast.success("Receipt updated.");
    setEditTarget(null);
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    const result = await deleteReceipt(deleteTarget.id);
    if (result) {
      toast.error(result);
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

      <Dialog open={previewTarget !== null} onOpenChange={(open) => !open && setPreviewTarget(null)}>
        <DialogContent className="max-h-[92vh] overflow-hidden border-border bg-bg-base p-0 text-text-primary sm:max-w-3xl">
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

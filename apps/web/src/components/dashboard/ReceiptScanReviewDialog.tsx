import { useEffect, useMemo, useState } from "react";
import { FileText, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ExpenseCategory, FinanceTransactionType } from "@/hooks/useExpenses";
import type { ScanReceiptDraft } from "@/hooks/useScanReceipt";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "food_cost", label: "Food cost" },
  { value: "food_supplies", label: "Food supplies" },
  { value: "beverages", label: "Beverages" },
  { value: "utilities", label: "Utilities" },
  { value: "rent", label: "Rent" },
  { value: "equipment", label: "Equipment" },
  { value: "marketing", label: "Marketing" },
  { value: "staff", label: "Staff" },
  { value: "supplies", label: "Supplies" },
  { value: "maintenance", label: "Maintenance" },
  { value: "cleaning", label: "Cleaning" },
  { value: "sales", label: "Sales" },
  { value: "preorders", label: "Pre-orders" },
  { value: "events", label: "Events" },
  { value: "catering", label: "Catering" },
  { value: "delivery", label: "Delivery" },
  { value: "gift_cards", label: "Gift cards" },
  { value: "other", label: "Other" },
];

export type ReceiptScanReviewSubmit = {
  transaction_type: FinanceTransactionType;
  category: ExpenseCategory;
  vendor_name: string;
  expense_date: string;
  amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  payment_method: string | null;
  notes: string | null;
};

type ReceiptScanReviewDialogProps = {
  open: boolean;
  draft: ScanReceiptDraft | null;
  extractedFields: string[];
  fileName: string;
  filePreviewUrl: string | null;
  isImagePreviewable: boolean;
  defaultCurrency: string;
  saving: boolean;
  onCancel: () => void;
  onConfirm: (values: ReceiptScanReviewSubmit) => Promise<void> | void;
};

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function moneyString(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return String(value);
}

export function ReceiptScanReviewDialog({
  open,
  draft,
  extractedFields,
  fileName,
  filePreviewUrl,
  isImagePreviewable,
  defaultCurrency,
  saving,
  onCancel,
  onConfirm,
}: ReceiptScanReviewDialogProps) {
  const aiFieldSet = useMemo(() => new Set(extractedFields), [extractedFields]);
  const fallbackCurrency = (defaultCurrency || "cad").toLowerCase();

  const [transactionType, setTransactionType] = useState<FinanceTransactionType>("expense");
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [vendorName, setVendorName] = useState("");
  const [expenseDate, setExpenseDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [currency, setCurrency] = useState(fallbackCurrency);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Reset form whenever the dialog re-opens with a new draft.
  useEffect(() => {
    if (!open) return;
    setTransactionType("expense");
    setCategory((draft?.category as ExpenseCategory) ?? "other");
    setVendorName(draft?.vendor ?? "");
    setExpenseDate(draft?.expenseDate ?? todayIso());
    setAmount(moneyString(draft?.amount));
    setTaxAmount(moneyString(draft?.taxAmount));
    setTotalAmount(moneyString(draft?.totalAmount));
    setCurrency((draft?.currency ?? fallbackCurrency).toLowerCase());
    setPaymentMethod(draft?.paymentMethod ?? "");
    setNotes("");
    setFormError(null);
  }, [draft, fallbackCurrency, open]);

  const anyDraftField = useMemo(() => {
    if (!draft) return false;
    return (
      draft.vendor ||
      draft.expenseDate ||
      draft.amount != null ||
      draft.taxAmount != null ||
      draft.totalAmount != null ||
      draft.category ||
      draft.paymentMethod
    );
  }, [draft]);

  const aiBadge = (
    <Badge className="ml-2 gap-1 border border-gold/40 bg-gold/10 px-1.5 py-0 text-[9px] font-mono uppercase tracking-wider text-gold">
      <Sparkles className="size-2.5" /> AI
    </Badge>
  );

  const submit = async () => {
    const amountNum = Number(amount);
    const taxNum = taxAmount === "" ? 0 : Number(taxAmount);
    const explicitTotal = totalAmount === "" ? NaN : Number(totalAmount);
    if (!vendorName.trim()) {
      setFormError("Vendor name is required.");
      return;
    }
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setFormError("Amount (subtotal) is required and must be 0 or more.");
      return;
    }
    if (!Number.isFinite(taxNum) || taxNum < 0) {
      setFormError("Tax must be 0 or more.");
      return;
    }
    if (!expenseDate) {
      setFormError("Receipt date is required.");
      return;
    }
    const resolvedTotal = Number.isFinite(explicitTotal) && explicitTotal >= 0
      ? explicitTotal
      : amountNum + (Number.isFinite(taxNum) ? taxNum : 0);

    setFormError(null);
    await onConfirm({
      transaction_type: transactionType,
      category,
      vendor_name: vendorName.trim(),
      expense_date: expenseDate,
      amount: amountNum,
      tax_amount: taxNum,
      total_amount: resolvedTotal,
      currency: (currency || fallbackCurrency).toLowerCase(),
      payment_method: paymentMethod.trim() || null,
      notes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onCancel()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-bg-base text-text-primary sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-serif text-2xl">
            <Sparkles className="size-5 text-gold" />
            Review scanned receipt
          </DialogTitle>
          <DialogDescription>
            {anyDraftField
              ? "We pre-filled the fields below from your receipt. Double-check anything marked AI and save to add an expense."
              : "We couldn't read this receipt automatically. Fill in the fields below to save it as an expense."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-xl border border-border bg-bg-elevated/40">
              {filePreviewUrl && isImagePreviewable ? (
                <img
                  src={filePreviewUrl}
                  alt={fileName}
                  className="block max-h-72 w-full object-contain"
                />
              ) : (
                <div className="flex h-44 items-center justify-center text-text-muted">
                  <FileText className="size-10 text-gold" />
                </div>
              )}
            </div>
            <p className="truncate text-xs text-text-muted" title={fileName}>
              {fileName}
            </p>
          </div>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Transaction type</Label>
                <Select
                  value={transactionType}
                  onValueChange={(value) => setTransactionType(value as FinanceTransactionType)}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="expense">Expense</SelectItem>
                    <SelectItem value="income">Income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className={cn("flex items-center")}>
                  Category
                  {aiFieldSet.has("category") && aiBadge}
                </Label>
                <Select value={category} onValueChange={(value) => setCategory(value as ExpenseCategory)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scan-vendor" className="flex items-center">
                Vendor
                {aiFieldSet.has("vendor") && aiBadge}
              </Label>
              <Input
                id="scan-vendor"
                placeholder="Vendor name"
                value={vendorName}
                onChange={(event) => setVendorName(event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scan-date" className="flex items-center">
                  Receipt date
                  {aiFieldSet.has("expenseDate") && aiBadge}
                </Label>
                <Input
                  id="scan-date"
                  type="date"
                  value={expenseDate}
                  onChange={(event) => setExpenseDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scan-currency">Currency</Label>
                <Input
                  id="scan-currency"
                  value={currency}
                  maxLength={6}
                  onChange={(event) => setCurrency(event.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="scan-amount" className="flex items-center">
                  Subtotal
                  {aiFieldSet.has("amount") && aiBadge}
                </Label>
                <Input
                  id="scan-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scan-tax" className="flex items-center">
                  Tax
                  {aiFieldSet.has("taxAmount") && aiBadge}
                </Label>
                <Input
                  id="scan-tax"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={taxAmount}
                  onChange={(event) => setTaxAmount(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="scan-total" className="flex items-center">
                  Total
                  {aiFieldSet.has("totalAmount") && aiBadge}
                </Label>
                <Input
                  id="scan-total"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={totalAmount}
                  onChange={(event) => setTotalAmount(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="scan-payment" className="flex items-center">
                Payment method
                {aiFieldSet.has("paymentMethod") && aiBadge}
              </Label>
              <Input
                id="scan-payment"
                placeholder="visa ****4242, cash, debit…"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scan-notes">Notes</Label>
              <Textarea
                id="scan-notes"
                rows={2}
                placeholder="Optional notes (purpose, attendees, etc.)"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>

            {formError && (
              <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                {formError}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
            Skip for now
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? "Saving…" : "Save expense"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

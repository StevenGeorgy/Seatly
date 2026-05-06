import { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, isValid, parse } from "date-fns";
import { CalendarDays, Coins, Download, ListChecks, Pencil, Plus, Receipt, Trash2, WalletCards } from "lucide-react";
import { motion } from "framer-motion";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { ReceiptsLibrary } from "@/components/dashboard/ReceiptsLibrary";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import {
  useExpenses,
  type ExpenseCategory,
  type ExpenseFrequency,
  type ExpenseRow,
  type ExpenseStatus,
  type FinanceTransactionType,
  type RecurringExpenseRule,
} from "@/hooks/useExpenses";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const PRESET_RANGES = ["Day", "Week", "Month", "Quarter", "Year"] as const;
const RANGES = [...PRESET_RANGES, "Custom"] as const;
type PresetRangeKey = (typeof PRESET_RANGES)[number];
type RangeKey = (typeof RANGES)[number];

const RANGE_LABELS: Record<RangeKey, string> = {
  Day: "Today",
  Week: "This week",
  Month: "This month",
  Quarter: "This quarter",
  Year: "This year",
  Custom: "Custom",
};

const TRANSACTION_TYPE_OPTIONS: Array<{ value: FinanceTransactionType; label: string }> = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

const EXPENSE_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
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
  { value: "other", label: "Other" },
];

const INCOME_CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "sales", label: "Sales" },
  { value: "preorders", label: "Pre-orders" },
  { value: "events", label: "Events" },
  { value: "catering", label: "Catering" },
  { value: "delivery", label: "Delivery" },
  { value: "gift_cards", label: "Gift cards" },
  { value: "other", label: "Other" },
];

const CATEGORY_OPTIONS = [...EXPENSE_CATEGORY_OPTIONS, ...INCOME_CATEGORY_OPTIONS];
const CATEGORY_VALUES = [
  "food_cost",
  "food_supplies",
  "beverages",
  "utilities",
  "rent",
  "equipment",
  "marketing",
  "staff",
  "supplies",
  "maintenance",
  "cleaning",
  "sales",
  "preorders",
  "events",
  "catering",
  "delivery",
  "gift_cards",
  "other",
] as const;

const FREQUENCY_OPTIONS: Array<{ value: ExpenseFrequency; label: string }> = [
  { value: "one_time", label: "One-time" },
  { value: "weekly", label: "Weekly" },
  { value: "bi_weekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

const STATUS_OPTIONS: Array<{ value: ExpenseStatus; label: string }> = [
  { value: "paid", label: "Paid" },
  { value: "due", label: "Due" },
  { value: "scheduled", label: "Scheduled" },
  { value: "overdue", label: "Overdue" },
];

const expenseSchema = z.object({
  transaction_type: z.enum(["expense", "income"]),
  vendor_name: z.string().trim().min(1, "Name is required."),
  category: z.enum(CATEGORY_VALUES),
  description: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  amount: z.number().min(0, "Amount must be zero or more."),
  tax_amount: z.number().min(0, "Tax must be zero or more."),
  expense_date: z.string().min(1, "Date is required."),
  payment_status: z.enum(["paid", "due", "scheduled", "overdue"]),
  frequency: z.enum(["one_time", "weekly", "bi_weekly", "monthly", "quarterly", "yearly"]),
  recurring_end_date: z.string().optional(),
});

type ExpenseFormValues = z.infer<typeof expenseSchema>;

function transactionTypeFor(row: ExpenseRow | RecurringExpenseRule): FinanceTransactionType {
  return row.transaction_type ?? "expense";
}

function categoryOptionsFor(type: FinanceTransactionType): Array<{ value: ExpenseCategory; label: string }> {
  return type === "income" ? INCOME_CATEGORY_OPTIONS : EXPENSE_CATEGORY_OPTIONS;
}

function categoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category.replace(/_/g, " ");
}

function typeLabel(type: FinanceTransactionType): string {
  return TRANSACTION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function frequencyLabel(frequency: string): string {
  return FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency.replace(/_/g, " ");
}

function statusLabel(status: string | undefined, type: FinanceTransactionType = "expense"): string {
  if (type === "income") {
    switch (status) {
      case "due":
        return "Expected";
      case "scheduled":
        return "Scheduled";
      case "overdue":
        return "Overdue";
      default:
        return "Received";
    }
  }
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "Paid";
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case "overdue":
      return "text-danger";
    case "due":
      return "text-warning";
    case "scheduled":
      return "text-info";
    default:
      return "text-success";
  }
}

function isoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function rangeStart(range: PresetRangeKey, anchorDate: Date): string {
  const date = new Date(anchorDate);
  switch (range) {
    case "Day":
      break;
    case "Week":
      date.setDate(date.getDate() - date.getDay());
      break;
    case "Month":
      date.setDate(1);
      break;
    case "Quarter":
      date.setMonth(Math.floor(date.getMonth() / 3) * 3, 1);
      break;
    case "Year":
      date.setMonth(0, 1);
      break;
  }
  return isoDate(date);
}

function rangeEnd(range: PresetRangeKey, anchorDate: Date): string {
  const date = new Date(anchorDate);
  switch (range) {
    case "Day":
      break;
    case "Week":
      date.setDate(date.getDate() - date.getDay() + 6);
      break;
    case "Month":
      date.setMonth(date.getMonth() + 1, 0);
      break;
    case "Quarter": {
      const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
      date.setMonth(quarterStartMonth + 3, 0);
      break;
    }
    case "Year":
      date.setMonth(11, 31);
      break;
  }
  return isoDate(date);
}

function shortDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function readableDate(date: string): string {
  const parsed = parse(date, "yyyy-MM-dd", new Date());
  if (!isValid(parsed)) return date;
  return format(parsed, "MMM d, yyyy");
}

function recurringOccurrenceAmount(rule: RecurringExpenseRule): number {
  return rule.total_amount;
}

function rangeCaption(range: RangeKey): string {
  if (range === "Day") return "today";
  if (range === "Custom") return "in this custom range";
  return `this ${range.toLowerCase()}`;
}

type LedgerRow =
  | { kind: "expense"; type: FinanceTransactionType; id: string; date: string; vendor: string; category: string; description: string; status: string; amount: number; currency: string; expense: ExpenseRow }
  | { kind: "recurring"; type: FinanceTransactionType; id: string; date: string; vendor: string; category: string; description: string; status: string; amount: number; currency: string; rule: RecurringExpenseRule };

type DeleteTarget =
  | { kind: "expense"; expense: ExpenseRow }
  | { kind: "recurring"; rule: RecurringExpenseRule };

function downloadLedgerCsv(ledgerRows: LedgerRow[]) {
  const rows = [
    ["row_type", "transaction_type", "date", "name", "category", "description", "status", "amount"],
    ...ledgerRows.map((row) => [
      row.kind,
      row.type,
      row.date,
      row.vendor,
      row.category,
      row.description,
      row.status,
      String(row.amount),
    ]),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, "\"\"")}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "income-expenses.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function ExpenseDateField({
  value,
  onChange,
  placeholder,
  allowClear = true,
  disableBefore,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder: string;
  allowClear?: boolean;
  disableBefore?: Date;
}) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => {
    if (!value) return undefined;
    const date = parse(value, "yyyy-MM-dd", new Date());
    return isValid(date) ? date : undefined;
  }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-full cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <span className={cn("truncate text-xs leading-none", value ? "text-text-primary" : "text-text-muted")}>
            {selected ? format(selected, "EEE, MMM d, yyyy") : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-2 text-text-primary shadow-2xl">
        <Calendar
          mode="single"
          required={false}
          showOutsideDays={false}
          selected={selected}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            if (date) setOpen(false);
          }}
          disabled={disableBefore ? { before: disableBefore } : undefined}
          classNames={{
            day: "group/day relative flex-1 p-0 text-center select-none",
            day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black",
            hidden: "invisible pointer-events-none",
            outside: "invisible pointer-events-none",
            disabled: "text-text-muted opacity-25",
            today: "text-white",
          }}
          className="rounded-md border-0 bg-transparent"
        />
        {allowClear && value && (
          <div className="border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-text-secondary hover:bg-bg-surface hover:text-text-primary"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function ExpensesPage() {
  const [view, setView] = useState<"entries" | "receipts">("entries");
  const [range, setRange] = useState<RangeKey>("Month");
  const [customDateFrom, setCustomDateFrom] = useState(() => rangeStart("Month", new Date()));
  const [customDateTo, setCustomDateTo] = useState(() => rangeEnd("Month", new Date()));
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExpenseRow | null>(null);
  const [recurringEditTarget, setRecurringEditTarget] = useState<RecurringExpenseRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const filters = useMemo(() => {
    if (range === "Custom") return { dateFrom: customDateFrom, dateTo: customDateTo };
    const today = new Date();
    return { dateFrom: rangeStart(range, today), dateTo: rangeEnd(range, today) };
  }, [customDateFrom, customDateTo, range]);
  const { expenses, recurringRules, loading, saving, createExpense, updateExpense, updateRecurringRule, deleteExpense, deleteRecurringRule } = useExpenses(filters);
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
      transaction_type: "expense",
      vendor_name: "",
      category: "food_cost",
      description: "",
      notes: "",
      amount: 0,
      tax_amount: 0,
      expense_date: isoDate(new Date()),
      payment_status: "paid",
      frequency: "one_time",
      recurring_end_date: "",
    },
  });
  const amountValue = form.watch("amount") || 0;
  const taxValue = form.watch("tax_amount") || 0;
  const transactionTypeValue = form.watch("transaction_type");
  const frequencyValue = form.watch("frequency");
  const expenseDateValue = form.watch("expense_date");
  const totalValue = amountValue + taxValue;
  const activeCategoryOptions = categoryOptionsFor(transactionTypeValue);

  useEffect(() => {
    if (activeCategoryOptions.some((option) => option.value === form.getValues("category"))) return;
    form.setValue("category", activeCategoryOptions[0]?.value ?? "other", { shouldDirty: true });
  }, [activeCategoryOptions, form, transactionTypeValue]);

  useEffect(() => {
    if (customDateTo >= customDateFrom) return;
    setCustomDateTo(customDateFrom);
  }, [customDateFrom, customDateTo]);

  const actualExpenses = useMemo(
    () => expenses.filter((expense) => transactionTypeFor(expense) === "expense"),
    [expenses],
  );
  const actualIncome = useMemo(
    () => expenses.filter((expense) => transactionTypeFor(expense) === "income"),
    [expenses],
  );
  const recurringExpenses = useMemo(
    () => recurringRules.filter((rule) => transactionTypeFor(rule) === "expense"),
    [recurringRules],
  );
  const recurringIncome = useMemo(
    () => recurringRules.filter((rule) => transactionTypeFor(rule) === "income"),
    [recurringRules],
  );
  const totalSpend = useMemo(
    () => actualExpenses.reduce((sum, expense) => sum + expense.total_amount, 0),
    [actualExpenses],
  );
  const totalIncome = useMemo(
    () => actualIncome.reduce((sum, income) => sum + income.total_amount, 0),
    [actualIncome],
  );
  const dueSpend = useMemo(
    () => actualExpenses.filter((expense) => ["due", "overdue", "scheduled"].includes(expense.payment_status ?? "paid")).reduce((sum, expense) => sum + expense.total_amount, 0),
    [actualExpenses],
  );
  const recurringSpend = useMemo(
    () => recurringExpenses.reduce((sum, rule) => sum + recurringOccurrenceAmount(rule), 0),
    [recurringExpenses],
  );
  const recurringIncomeTotal = useMemo(
    () => recurringIncome.reduce((sum, rule) => sum + recurringOccurrenceAmount(rule), 0),
    [recurringIncome],
  );
  const netIncome = totalIncome + recurringIncomeTotal - totalSpend - recurringSpend;
  const selectedRangeCaption = rangeCaption(range);
  const displayRangeLabel = range === "Custom"
    ? `${readableDate(customDateFrom)} to ${readableDate(customDateTo)}`
    : RANGE_LABELS[range];
  const customStartDate = useMemo(() => {
    const parsed = parse(customDateFrom, "yyyy-MM-dd", new Date());
    return isValid(parsed) ? parsed : undefined;
  }, [customDateFrom]);
  const categoryRows = useMemo(() => {
    const totals = new Map<string, { type: FinanceTransactionType; category: string; amount: number }>();
    expenses.forEach((expense) => {
      const type = transactionTypeFor(expense);
      const key = `${type}:${expense.category}`;
      const existing = totals.get(key);
      totals.set(key, { type, category: expense.category, amount: (existing?.amount ?? 0) + expense.total_amount });
    });
    recurringRules.forEach((rule) => {
      const type = transactionTypeFor(rule);
      const key = `${type}:${rule.category}`;
      const existing = totals.get(key);
      totals.set(key, { type, category: rule.category, amount: (existing?.amount ?? 0) + recurringOccurrenceAmount(rule) });
    });
    const rows = Array.from(totals.values())
      .map((row) => ({ ...row, label: `${typeLabel(row.type)} · ${categoryLabel(row.category)}` }))
      .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    return rows.map((row) => ({ ...row, pct: total > 0 ? (row.amount / total) * 100 : 0 }));
  }, [expenses, recurringRules]);
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const actualRows: LedgerRow[] = expenses.map((expense) => ({
      kind: "expense",
      type: transactionTypeFor(expense),
      id: expense.id,
      date: expense.expense_date,
      vendor: expense.vendor_name ?? "Unknown vendor",
      category: expense.category,
      description: expense.description ?? "No description",
      status: expense.payment_status ?? "paid",
      amount: expense.total_amount,
      currency: expense.currency || currency,
      expense,
    }));
    const recurringRows: LedgerRow[] = recurringRules.map((rule) => ({
      kind: "recurring",
      type: transactionTypeFor(rule),
      id: rule.id,
      date: rule.next_due_date,
      vendor: rule.vendor_name,
      category: rule.category,
      description: `${frequencyLabel(rule.frequency)} recurring ${transactionTypeFor(rule)}`,
      status: "recurring",
      amount: recurringOccurrenceAmount(rule),
      currency: rule.currency || currency,
      rule,
    }));
    return [...actualRows, ...recurringRows].sort((a, b) => b.date.localeCompare(a.date));
  }, [currency, expenses, recurringRules]);
  const stats = [
    { label: "Income", value: formatCurrency(totalIncome + recurringIncomeTotal, currency), caption: `${actualIncome.length} actual income entries ${selectedRangeCaption}` },
    { label: "Expenses", value: formatCurrency(totalSpend + recurringSpend, currency), caption: `${actualExpenses.length} actual expense entries ${selectedRangeCaption}` },
    { label: "Net", value: formatCurrency(netIncome, currency), caption: `${netIncome >= 0 ? "Positive" : "Negative"} tracked cash flow` },
    { label: "Due or scheduled", value: formatCurrency(dueSpend, currency), caption: `Upcoming cash out ${selectedRangeCaption}` },
  ];

  const resetForm = () => {
    form.reset({
      transaction_type: "expense",
      vendor_name: "",
      category: "food_cost",
      description: "",
      notes: "",
      amount: 0,
      tax_amount: 0,
      expense_date: isoDate(new Date()),
      payment_status: "paid",
      frequency: "one_time",
      recurring_end_date: "",
    });
  };

  const openCreateForm = () => {
    setEditTarget(null);
    setRecurringEditTarget(null);
    resetForm();
    setFormOpen(true);
  };

  const openEditForm = (expense: ExpenseRow) => {
    setEditTarget(expense);
    setRecurringEditTarget(null);
    form.reset({
      transaction_type: transactionTypeFor(expense),
      vendor_name: expense.vendor_name ?? "",
      category: expense.category as ExpenseCategory,
      description: expense.description ?? "",
      notes: expense.notes ?? "",
      amount: expense.amount,
      tax_amount: expense.tax_amount ?? 0,
      expense_date: expense.expense_date,
      payment_status: expense.payment_status ?? "paid",
      frequency: "one_time",
      recurring_end_date: "",
    });
    setFormOpen(true);
  };

  const openEditRecurringForm = (rule: RecurringExpenseRule) => {
    setEditTarget(null);
    setRecurringEditTarget(rule);
    form.reset({
      transaction_type: transactionTypeFor(rule),
      vendor_name: rule.vendor_name,
      category: rule.category as ExpenseCategory,
      description: rule.description ?? "",
      notes: "",
      amount: rule.amount,
      tax_amount: rule.tax_amount ?? 0,
      expense_date: rule.start_date,
      payment_status: "scheduled",
      frequency: rule.frequency,
      recurring_end_date: rule.end_date ?? "",
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditTarget(null);
    setRecurringEditTarget(null);
    resetForm();
  };

  const onSubmit = form.handleSubmit(async (values) => {
    if (recurringEditTarget && values.frequency === "one_time") {
      toast.error("Choose a recurring frequency.");
      return;
    }
    const entryLabel = values.transaction_type === "income" ? "income" : "expense";
    const payload = {
      ...values,
      description: values.description || null,
      notes: values.notes || null,
      tax_amount: values.tax_amount ?? 0,
      total_amount: values.amount + (values.tax_amount ?? 0),
      currency,
      recurring_end_date: values.recurring_end_date || null,
    };
    const result = recurringEditTarget
      ? await updateRecurringRule(recurringEditTarget.id, payload)
      : editTarget
        ? await updateExpense(editTarget.id, payload)
        : await createExpense(payload);
    if (result) {
      toast.error(result);
      return;
    }
    toast.success(
      recurringEditTarget
        ? `Recurring ${entryLabel} updated.`
        : editTarget
          ? `${typeLabel(values.transaction_type)} updated.`
          : values.frequency === "one_time"
            ? `${typeLabel(values.transaction_type)} logged.`
            : `${typeLabel(values.transaction_type)} and recurring ${entryLabel} saved.`,
    );
    closeForm();
  });

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const result = deleteTarget.kind === "expense"
      ? await deleteExpense(deleteTarget.expense.id)
      : await deleteRecurringRule(deleteTarget.rule.id);
    if (result) {
      toast.error(result);
      return;
    }
    toast.success(deleteTarget.kind === "expense" ? `${typeLabel(transactionTypeFor(deleteTarget.expense))} deleted.` : `Recurring ${transactionTypeFor(deleteTarget.rule)} removed.`);
    setDeleteTarget(null);
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
      >
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            <Coins className="size-3.5" />
            Finance ledger
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Income & Expenses</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Log money going out and money coming in by category, status, and recurring cycle.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center rounded-lg border border-border bg-bg-elevated/40 p-1">
            {RANGES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setRange(key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  range === key ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
                )}
              >
                {RANGE_LABELS[key]}
              </button>
            ))}
          </div>
          {range === "Custom" && (
            <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
              <div className="w-full space-y-1 sm:w-[180px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">Start date</span>
                <ExpenseDateField
                  value={customDateFrom}
                  onChange={(date) => {
                    if (date) setCustomDateFrom(date);
                  }}
                  placeholder="Start date"
                  allowClear={false}
                />
              </div>
              <div className="w-full space-y-1 sm:w-[180px]">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-text-muted">End date</span>
                <ExpenseDateField
                  value={customDateTo}
                  onChange={(date) => {
                    if (date) setCustomDateTo(date);
                  }}
                  placeholder="End date"
                  allowClear={false}
                  disableBefore={customStartDate}
                />
              </div>
            </div>
          )}
          <div className="flex items-center rounded-lg border border-border bg-bg-elevated/40 p-1">
            <button
              type="button"
              onClick={() => setView("entries")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                view === "entries" ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
              )}
            >
              <ListChecks className="size-3.5" />
              Entries
            </button>
            <button
              type="button"
              onClick={() => setView("receipts")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                view === "receipts" ? "bg-gold/15 text-gold" : "text-text-muted hover:text-text-secondary",
              )}
            >
              <Receipt className="size-3.5" />
              Receipts
            </button>
          </div>
          <Button size="default" className="gap-2" onClick={openCreateForm}>
            <Plus className="size-4" />
            Log entry
          </Button>
        </div>
      </motion.header>

      {view === "entries" && (
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
            <p className="mt-3 font-serif text-3xl text-white xl:text-4xl">{stat.value}</p>
            <p className="mt-2 text-xs text-text-muted">{stat.caption}</p>
          </article>
        ))}
      </section>
      )}

      {view === "entries" && (
      <section className="grid gap-5 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.82fr)]">
        <article className="min-h-[520px] rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
          <h2 className="font-serif text-2xl text-white">By category</h2>
          <p className="mt-1 text-xs text-text-muted">Actual entries plus upcoming recurring entries · {displayRangeLabel}</p>
          <div className="mt-6 space-y-5">
            {categoryRows.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">
                Log an expense or income entry to populate this category graph.
              </p>
            )}
            {categoryRows.map((cat) => (
              <div key={`${cat.type}-${cat.category}`}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{cat.label}</span>
                  <span className={cn("font-mono text-xs", cat.type === "income" ? "text-success" : "text-gold")}>{formatCurrency(cat.amount, currency)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                  <div className={cn("h-full rounded-full", cat.type === "income" ? "bg-success" : "bg-gold")} style={{ width: `${cat.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
          <div className="flex items-start justify-between gap-4 px-5 py-5 lg:px-6">
            <div>
              <h2 className="font-serif text-2xl text-white">Recent transactions</h2>
              <p className="mt-1 text-xs text-text-muted">
                {displayRangeLabel} · {expenses.length} actual entries · {recurringRules.length} upcoming recurring entries
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadLedgerCsv(ledgerRows)}>
              <Download className="size-3.5" />
              Export CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  <th className="px-5 py-3 font-medium lg:px-6">Date</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Description</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium lg:px-6">Amount</th>
                  <th className="px-5 py-3 text-right font-medium lg:px-6">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loading && (
                  <tr>
                    <td className="px-5 py-8 text-sm text-text-muted lg:px-6" colSpan={8}>
                      Loading finance entries...
                    </td>
                  </tr>
                )}
                {!loading && ledgerRows.length === 0 && (
                  <tr>
                    <td className="px-5 py-8 text-sm text-text-muted lg:px-6" colSpan={8}>
                      No income, expenses, or recurring rules saved for this range.
                    </td>
                  </tr>
                )}
                {!loading && ledgerRows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="text-sm transition-colors hover:bg-bg-elevated/30">
                    <td className="px-5 py-4 font-mono text-text-muted lg:px-6">{shortDate(row.date)}</td>
                    <td className={cn("px-5 py-4 font-mono text-[10px] uppercase tracking-wider", row.type === "income" ? "text-success" : "text-gold")}>
                      {row.kind === "recurring" ? `Recurring ${row.type}` : typeLabel(row.type)}
                    </td>
                    <td className="px-5 py-4 text-text-primary">{row.vendor}</td>
                    <td className="px-5 py-4 text-text-secondary">{categoryLabel(row.category)}</td>
                    <td className="px-5 py-4 text-text-secondary">
                      <div>{row.description}</div>
                      {row.kind === "recurring" && (
                        <div className="mt-1 text-xs text-text-muted">
                          Next {frequencyLabel(row.rule.frequency).toLowerCase()} occurrence
                        </div>
                      )}
                    </td>
                    <td className={cn("px-5 py-4 font-mono text-[10px] uppercase tracking-wider", row.kind === "recurring" ? "text-gold" : statusClass(row.status))}>
                      {row.kind === "recurring" ? "Recurring" : statusLabel(row.status, row.type)}
                    </td>
                    <td className="px-5 py-4 text-right lg:px-6">
                      <div className={row.type === "income" ? "text-success" : "text-text-primary"}>
                        {row.type === "income" ? "+" : "-"}{formatCurrency(row.amount, row.currency)}
                      </div>
                      {row.kind === "recurring" && <div className="text-xs text-text-muted">next due</div>}
                    </td>
                    <td className="px-5 py-4 text-right lg:px-6">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-text-muted hover:text-white"
                          onClick={() => {
                            if (row.kind === "expense") openEditForm(row.expense);
                            else openEditRecurringForm(row.rule);
                          }}
                          aria-label={row.kind === "expense" ? `Edit ${row.type}` : `Edit recurring ${row.type}`}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-text-muted hover:text-danger"
                          onClick={() => {
                            if (row.kind === "expense") setDeleteTarget({ kind: "expense", expense: row.expense });
                            else setDeleteTarget({ kind: "recurring", rule: row.rule });
                          }}
                          aria-label={row.kind === "expense" ? `Delete ${row.type}` : `Remove recurring ${row.type}`}
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
      </section>
      )}

      {view === "receipts" && (
        <ReceiptsLibrary currency={currency} rangeCaption={selectedRangeCaption} />
      )}

      <Dialog open={formOpen} onOpenChange={(open) => {
        if (open) setFormOpen(true);
        else closeForm();
      }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-bg-base text-text-primary sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {recurringEditTarget ? `Edit recurring ${transactionTypeValue}` : editTarget ? `Edit ${transactionTypeValue}` : "Log expense or income"}
            </DialogTitle>
            <DialogDescription>
              {recurringEditTarget
                ? "Update the recurring rule used for future forecasting."
                : editTarget
                  ? "Update the saved finance record."
                  : "Save actual money in or out, and optionally create a recurring rule for forecasting."}
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Type</Label>
                <Controller
                  control={form.control}
                  name="transaction_type"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRANSACTION_TYPE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendor_name">{transactionTypeValue === "income" ? "Source" : "Vendor"}</Label>
                <Input
                  id="vendor_name"
                  placeholder={transactionTypeValue === "income" ? "DoorDash, event tickets, catering client" : "Toronto Hydro"}
                  {...form.register("vendor_name")}
                />
                {form.formState.errors.vendor_name && <p className="text-xs text-danger">{form.formState.errors.vendor_name.message}</p>}
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Controller
                  control={form.control}
                  name="category"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {activeCategoryOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                placeholder={transactionTypeValue === "income" ? "Weekend pre-orders, private event deposit, catering invoice..." : "May rent, weekly produce, annual insurance..."}
                {...form.register("description")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  onFocus={(event) => {
                    if (event.currentTarget.value === "0") event.currentTarget.select();
                  }}
                  onMouseUp={(event) => {
                    if (event.currentTarget.value === "0") event.preventDefault();
                  }}
                  {...form.register("amount", { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tax_amount">Tax</Label>
                <Input
                  id="tax_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  onFocus={(event) => {
                    if (event.currentTarget.value === "0") event.currentTarget.select();
                  }}
                  onMouseUp={(event) => {
                    if (event.currentTarget.value === "0") event.preventDefault();
                  }}
                  {...form.register("tax_amount", { valueAsNumber: true })}
                />
              </div>
              <div className="rounded-xl border border-border bg-bg-elevated/60 p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">Total</p>
                <p className="mt-2 font-serif text-2xl text-white">{formatCurrency(totalValue, currency)}</p>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Date</Label>
                <Controller
                  control={form.control}
                  name="expense_date"
                  render={({ field }) => (
                    <ExpenseDateField
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Select expense date"
                      allowClear={false}
                    />
                  )}
                />
              </div>
              <div className="space-y-2">
                {recurringEditTarget ? (
                  <>
                    <Label>{transactionTypeValue === "income" ? "Income status" : "Bill status"}</Label>
                    <div className="flex h-10 items-center rounded-lg border border-border bg-bg-elevated px-3 font-mono text-[10px] uppercase tracking-wider text-gold">
                      Recurring
                    </div>
                  </>
                ) : (
                  <>
                    <Label>Status</Label>
                    <Controller
                      control={form.control}
                      name="payment_status"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>{statusLabel(option.value, transactionTypeValue)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  </>
                )}
              </div>
              <div className="space-y-2">
                <Label>Frequency</Label>
                <Controller
                  control={form.control}
                  name="frequency"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!editTarget}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FREQUENCY_OPTIONS.filter((option) => recurringEditTarget ? option.value !== "one_time" : true).map((option) => (
                          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {editTarget && (
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    Frequency applies when creating a recurring rule. This edit updates the saved entry only.
                  </p>
                )}
                {recurringEditTarget && (
                  <p className="text-[11px] leading-relaxed text-text-muted">
                    Changing frequency updates the recurring forecast.
                  </p>
                )}
              </div>
            </div>

            {!editTarget && frequencyValue !== "one_time" && (
              <div className="rounded-xl border border-gold/20 bg-gold/10 p-4">
                <div className="flex gap-3">
                  <WalletCards className="mt-0.5 size-4 shrink-0 text-gold" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">Recurring {transactionTypeValue} rule</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                      {recurringEditTarget
                        ? `This updates the ${frequencyLabel(frequencyValue).toLowerCase()} rule for future forecasting.`
                        : `This will save today's ${transactionTypeValue} and create a ${frequencyLabel(frequencyValue).toLowerCase()} rule for future forecasting.`}
                    </p>
                    <div className="mt-3 max-w-xs space-y-2">
                      <Label>Optional end date</Label>
                      <Controller
                        control={form.control}
                        name="recurring_end_date"
                        render={({ field }) => {
                          const startDate = expenseDateValue
                            ? parse(expenseDateValue, "yyyy-MM-dd", new Date())
                            : undefined;
                          return (
                            <ExpenseDateField
                              value={field.value ?? ""}
                              onChange={field.onChange}
                              placeholder="No end date"
                              disableBefore={startDate && isValid(startDate) ? startDate : undefined}
                            />
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" rows={3} placeholder="Internal notes for your team or accountant." {...form.register("notes")} />
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={closeForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="gap-2">
                <Plus className="size-4" />
                {saving ? "Saving..." : recurringEditTarget ? "Save recurring rule" : editTarget ? "Save changes" : "Save entry"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null);
      }}>
        <DialogContent className="border-border bg-bg-base text-text-primary sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {deleteTarget?.kind === "recurring" ? `Remove recurring ${transactionTypeFor(deleteTarget.rule)}?` : `Delete ${deleteTarget ? transactionTypeFor(deleteTarget.expense) : "entry"}?`}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "recurring"
                ? "This stops the rule from contributing to recurring forecasts."
                : "This removes the entry from reports without deleting its audit trail from the database."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-bg-surface p-4">
            <p className="text-sm font-medium text-white">
              {deleteTarget?.kind === "recurring"
                ? deleteTarget.rule.vendor_name
                : deleteTarget?.expense.vendor_name ?? "Entry"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {deleteTarget?.kind === "recurring"
                ? `${frequencyLabel(deleteTarget.rule.frequency)} · ${formatCurrency(recurringOccurrenceAmount(deleteTarget.rule), deleteTarget.rule.currency || currency)} per occurrence`
                : deleteTarget
                  ? `${shortDate(deleteTarget.expense.expense_date)} · ${formatCurrency(deleteTarget.expense.total_amount, deleteTarget.expense.currency || currency)}`
                  : ""}
            </p>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={() => void confirmDelete()} disabled={saving}>
              {saving ? "Deleting..." : deleteTarget?.kind === "recurring" ? "Remove rule" : "Delete entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}

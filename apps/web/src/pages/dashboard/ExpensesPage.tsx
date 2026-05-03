import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { format, isValid, parse } from "date-fns";
import { CalendarDays, Coins, Download, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { motion } from "framer-motion";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
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
  type RecurringExpenseRule,
} from "@/hooks/useExpenses";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const RANGES = ["Week", "Month", "Quarter", "Year"] as const;
type RangeKey = (typeof RANGES)[number];

const CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
  { value: "food_cost", label: "Food cost" },
  { value: "beverages", label: "Beverages" },
  { value: "utilities", label: "Utilities" },
  { value: "rent", label: "Rent" },
  { value: "equipment", label: "Equipment" },
  { value: "marketing", label: "Marketing" },
  { value: "staff", label: "Staff" },
  { value: "supplies", label: "Supplies" },
  { value: "maintenance", label: "Maintenance" },
  { value: "other", label: "Other" },
];

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
  vendor_name: z.string().trim().min(1, "Vendor is required."),
  category: z.enum([
    "food_cost",
    "beverages",
    "utilities",
    "rent",
    "equipment",
    "marketing",
    "staff",
    "supplies",
    "maintenance",
    "other",
  ]),
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

function categoryLabel(category: string): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category.replace(/_/g, " ");
}

function frequencyLabel(frequency: string): string {
  return FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency.replace(/_/g, " ");
}

function statusLabel(status: string | undefined): string {
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
  return date.toISOString().slice(0, 10);
}

function rangeStart(range: RangeKey): string {
  const date = new Date();
  switch (range) {
    case "Week":
      date.setDate(date.getDate() - 7);
      break;
    case "Month":
      date.setMonth(date.getMonth() - 1);
      break;
    case "Quarter":
      date.setMonth(date.getMonth() - 3);
      break;
    case "Year":
      date.setFullYear(date.getFullYear() - 1);
      break;
  }
  return isoDate(date);
}

function shortDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function monthlyEquivalent(rule: RecurringExpenseRule): number {
  switch (rule.frequency) {
    case "weekly":
      return (rule.total_amount * 52) / 12;
    case "bi_weekly":
      return (rule.total_amount * 26) / 12;
    case "monthly":
      return rule.total_amount;
    case "quarterly":
      return rule.total_amount / 3;
    case "yearly":
      return rule.total_amount / 12;
  }
}

function recurringAmountForRange(rule: RecurringExpenseRule, range: RangeKey): number {
  const monthly = monthlyEquivalent(rule);
  switch (range) {
    case "Week":
      return monthly / (52 / 12);
    case "Month":
      return monthly;
    case "Quarter":
      return monthly * 3;
    case "Year":
      return monthly * 12;
  }
}

function rangeNoun(range: RangeKey): string {
  return range.toLowerCase();
}

type LedgerRow =
  | { kind: "expense"; id: string; date: string; vendor: string; category: string; description: string; status: string; amount: number; currency: string; expense: ExpenseRow }
  | { kind: "recurring"; id: string; date: string; vendor: string; category: string; description: string; status: string; amount: number; currency: string; rule: RecurringExpenseRule };

type DeleteTarget =
  | { kind: "expense"; expense: ExpenseRow }
  | { kind: "recurring"; rule: RecurringExpenseRule };

function downloadLedgerCsv(ledgerRows: LedgerRow[]) {
  const rows = [
    ["type", "date", "vendor", "category", "description", "status", "amount"],
    ...ledgerRows.map((row) => [
      row.kind,
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
  link.download = "expenses.csv";
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
  const [range, setRange] = useState<RangeKey>("Month");
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExpenseRow | null>(null);
  const [recurringEditTarget, setRecurringEditTarget] = useState<RecurringExpenseRule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const { selectedRestaurant } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const filters = useMemo(() => ({ dateFrom: rangeStart(range), dateTo: isoDate(new Date()) }), [range]);
  const { expenses, recurringRules, loading, saving, createExpense, updateExpense, updateRecurringRule, deleteExpense, deleteRecurringRule } = useExpenses(filters);
  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(expenseSchema),
    defaultValues: {
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
  const frequencyValue = form.watch("frequency");
  const expenseDateValue = form.watch("expense_date");
  const totalValue = amountValue + taxValue;

  const totalSpend = useMemo(
    () => expenses.reduce((sum, expense) => sum + expense.total_amount, 0),
    [expenses],
  );
  const paidSpend = useMemo(
    () => expenses.filter((expense) => (expense.payment_status ?? "paid") === "paid").reduce((sum, expense) => sum + expense.total_amount, 0),
    [expenses],
  );
  const dueSpend = useMemo(
    () => expenses.filter((expense) => ["due", "overdue", "scheduled"].includes(expense.payment_status ?? "paid")).reduce((sum, expense) => sum + expense.total_amount, 0),
    [expenses],
  );
  const recurringSpend = useMemo(
    () => recurringRules.reduce((sum, rule) => sum + recurringAmountForRange(rule, range), 0),
    [range, recurringRules],
  );
  const selectedRangeNoun = rangeNoun(range);
  const categoryRows = useMemo(() => {
    const totals = new Map<string, number>();
    expenses.forEach((expense) => {
      totals.set(expense.category, (totals.get(expense.category) ?? 0) + expense.total_amount);
    });
    recurringRules.forEach((rule) => {
      totals.set(rule.category, (totals.get(rule.category) ?? 0) + recurringAmountForRange(rule, range));
    });
    const rows = Array.from(totals.entries())
      .map(([category, amount]) => ({ category, label: categoryLabel(category), amount }))
      .sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    return rows.map((row) => ({ ...row, pct: total > 0 ? (row.amount / total) * 100 : 0 }));
  }, [expenses, range, recurringRules]);
  const ledgerRows = useMemo<LedgerRow[]>(() => {
    const actualRows: LedgerRow[] = expenses.map((expense) => ({
      kind: "expense",
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
      id: rule.id,
      date: rule.next_due_date,
      vendor: rule.vendor_name,
      category: rule.category,
      description: `${frequencyLabel(rule.frequency)} recurring bill`,
      status: "recurring",
      amount: recurringAmountForRange(rule, range),
      currency: rule.currency || currency,
      rule,
    }));
    return [...actualRows, ...recurringRows].sort((a, b) => b.date.localeCompare(a.date));
  }, [currency, expenses, range, recurringRules]);
  const stats = [
    { label: "Total spend", value: formatCurrency(totalSpend, currency), caption: `${expenses.length} actual entries this ${selectedRangeNoun}` },
    { label: "Cash paid", value: formatCurrency(paidSpend, currency), caption: `Paid actual expenses this ${selectedRangeNoun}` },
    { label: "Due or scheduled", value: formatCurrency(dueSpend, currency), caption: `Upcoming cash out this ${selectedRangeNoun}` },
    { label: `${range} recurring`, value: formatCurrency(recurringSpend, currency), caption: `${recurringRules.length} active bills forecast` },
  ];

  const resetForm = () => {
    form.reset({
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
        ? "Recurring bill updated."
        : editTarget
          ? "Expense updated."
          : values.frequency === "one_time"
            ? "Expense logged."
            : "Expense and recurring bill saved.",
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
    toast.success(deleteTarget.kind === "expense" ? "Expense deleted." : "Recurring bill removed.");
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
            Cost ledger
          </p>
          <h1 className="mt-2 font-serif text-3xl text-white sm:text-4xl">Expenses</h1>
          <p className="mt-1 text-sm italic text-text-muted">
            Saved costs by category, vendor, payment status, and recurring bill cycle.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
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
                {key}
              </button>
            ))}
          </div>
          <Button size="default" className="gap-2" onClick={openCreateForm}>
            <Plus className="size-4" />
            Log expense
          </Button>
        </div>
      </motion.header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <article key={stat.label} className="rounded-2xl border border-border bg-bg-surface p-5">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">{stat.label}</p>
            <p className="mt-3 font-serif text-3xl text-white xl:text-4xl">{stat.value}</p>
            <p className="mt-2 text-xs text-text-muted">{stat.caption}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-5 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.82fr)]">
        <article className="min-h-[520px] rounded-2xl border border-border bg-bg-surface p-5 lg:p-6">
          <h2 className="font-serif text-2xl text-white">By category</h2>
          <p className="mt-1 text-xs text-text-muted">Actual expenses plus recurring forecast · {selectedRangeNoun}</p>
          <div className="mt-6 space-y-5">
            {categoryRows.length === 0 && (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">
                Log an expense to populate this category graph.
              </p>
            )}
            {categoryRows.map((cat) => (
              <div key={cat.category}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-primary">{cat.label}</span>
                  <span className="font-mono text-xs text-gold">{formatCurrency(cat.amount, currency)}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-elevated">
                  <div className="h-full rounded-full bg-gold" style={{ width: `${cat.pct}%` }} />
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
                {range} range · {expenses.length} expenses · {recurringRules.length} recurring bills
              </p>
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => downloadLedgerCsv(ledgerRows)}>
              <Download className="size-3.5" />
              Export CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-border/60 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  <th className="px-5 py-3 font-medium lg:px-6">Date</th>
                  <th className="px-5 py-3 font-medium">Vendor</th>
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
                    <td className="px-5 py-8 text-sm text-text-muted lg:px-6" colSpan={7}>
                      Loading expenses...
                    </td>
                  </tr>
                )}
                {!loading && ledgerRows.length === 0 && (
                  <tr>
                    <td className="px-5 py-8 text-sm text-text-muted lg:px-6" colSpan={7}>
                      No expenses or recurring bills saved for this range.
                    </td>
                  </tr>
                )}
                {!loading && ledgerRows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`} className="text-sm transition-colors hover:bg-bg-elevated/30">
                    <td className="px-5 py-4 font-mono text-text-muted lg:px-6">{shortDate(row.date)}</td>
                    <td className="px-5 py-4 text-text-primary">{row.vendor}</td>
                    <td className="px-5 py-4 text-text-secondary">{categoryLabel(row.category)}</td>
                    <td className="px-5 py-4 text-text-secondary">
                      <div>{row.description}</div>
                      {row.kind === "recurring" && (
                        <div className="mt-1 text-xs text-text-muted">
                          Monthly equivalent from {formatCurrency(monthlyEquivalent(row.rule), row.currency)}
                        </div>
                      )}
                    </td>
                    <td className={cn("px-5 py-4 font-mono text-[10px] uppercase tracking-wider", row.kind === "recurring" ? "text-gold" : statusClass(row.status))}>
                      {row.kind === "recurring" ? "Recurring" : statusLabel(row.status)}
                    </td>
                    <td className="px-5 py-4 text-right lg:px-6">
                      <div className="text-text-primary">{formatCurrency(row.amount, row.currency)}</div>
                      {row.kind === "recurring" && <div className="text-xs text-text-muted">/ {selectedRangeNoun}</div>}
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
                          aria-label={row.kind === "expense" ? "Edit expense" : "Edit recurring bill"}
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
                          aria-label={row.kind === "expense" ? "Delete expense" : "Remove recurring bill"}
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

      <Dialog open={formOpen} onOpenChange={(open) => {
        if (open) setFormOpen(true);
        else closeForm();
      }}>
        <DialogContent className="max-h-[92vh] overflow-y-auto border-border bg-bg-base text-text-primary sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-serif text-2xl">
              {recurringEditTarget ? "Edit recurring bill" : editTarget ? "Edit expense" : "Log expense"}
            </DialogTitle>
            <DialogDescription>
              {recurringEditTarget
                ? "Update the recurring bill used for future expense forecasting."
                : editTarget
                  ? "Update the saved expense record."
                  : "Save actual costs and optionally create a recurring bill rule for forecasting."}
            </DialogDescription>
          </DialogHeader>

          <form className="grid gap-4" onSubmit={onSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="vendor_name">Vendor</Label>
                <Input id="vendor_name" placeholder="Toronto Hydro" {...form.register("vendor_name")} />
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
                        {CATEGORY_OPTIONS.map((option) => (
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
              <Input id="description" placeholder="May rent, weekly produce, annual insurance..." {...form.register("description")} />
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
                    <Label>Bill status</Label>
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
                              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
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
                    Frequency applies when creating a recurring bill. This edit updates the expense only.
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
                    <p className="text-sm font-medium text-white">Recurring bill rule</p>
                    <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                      {recurringEditTarget
                        ? `This updates the ${frequencyLabel(frequencyValue).toLowerCase()} rule for future forecasting.`
                        : `This will save today's expense and create a ${frequencyLabel(frequencyValue).toLowerCase()} rule for future forecasting.`}
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
                {saving ? "Saving..." : recurringEditTarget ? "Save bill" : editTarget ? "Save changes" : "Save expense"}
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
              {deleteTarget?.kind === "recurring" ? "Remove recurring bill?" : "Delete expense?"}
            </DialogTitle>
            <DialogDescription>
              {deleteTarget?.kind === "recurring"
                ? "This stops the bill from contributing to monthly recurring totals."
                : "This removes the expense from reports without deleting its audit trail from the database."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-border bg-bg-surface p-4">
            <p className="text-sm font-medium text-white">
              {deleteTarget?.kind === "recurring"
                ? deleteTarget.rule.vendor_name
                : deleteTarget?.expense.vendor_name ?? "Expense"}
            </p>
            <p className="mt-1 text-xs text-text-muted">
              {deleteTarget?.kind === "recurring"
                ? `${frequencyLabel(deleteTarget.rule.frequency)} · ${formatCurrency(monthlyEquivalent(deleteTarget.rule), deleteTarget.rule.currency || currency)} / month`
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
              {saving ? "Deleting..." : deleteTarget?.kind === "recurring" ? "Remove bill" : "Delete expense"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}

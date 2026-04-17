import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Receipt, Plus, Camera } from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useExpenses } from "@/hooks/useExpenses";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";

const EXPENSE_CATEGORIES = [
  "food_supplies", "beverages", "utilities", "rent", "payroll",
  "marketing", "equipment", "maintenance", "insurance", "other",
];

export default function ExpensesPage() {
  const { t } = useTranslation();
  const { selectedRestaurant, selectedRestaurantId } = useRestaurantScope();
  const currency = selectedRestaurant?.currency ?? "cad";
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const { expenses, loading, refetch } = useExpenses({ category: categoryFilter });

  const monthTotal = expenses.reduce((sum, e) => sum + e.total_amount, 0);

  const [addOpen, setAddOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);

  // Form state
  const [vendorName, setVendorName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("food_supplies");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState<Date | undefined>(new Date());
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setVendorName(""); setDescription(""); setCategory("food_supplies");
    setAmount(""); setExpenseDate(new Date());
  };

  const handleAdd = async () => {
    if (!amount || parseFloat(amount) <= 0) { toast.error("Amount is required."); return; }
    if (!expenseDate) { toast.error("Please select a date."); return; }
    if (!selectedRestaurantId || !isSupabaseConfigured()) return;
    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error } = await client.from("expenses").insert({
      restaurant_id: selectedRestaurantId,
      vendor_name: vendorName.trim() || null,
      description: description.trim() || null,
      category,
      amount: parseFloat(amount),
      total_amount: parseFloat(amount),
      tax_amount: null,
      currency: currency.toLowerCase(),
      expense_date: format(expenseDate, "yyyy-MM-dd"),
      ai_categorized: false,
    });
    if (error) { toast.error("Could not add expense."); setSaving(false); return; }
    toast.success("Expense added.");
    setSaving(false);
    setAddOpen(false);
    resetForm();
    void refetch();
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.expenses.title")}
        description={`${t("dashboard.expenses.monthlyTotal")}: ${formatCurrency(monthTotal, currency)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="default" className="gap-2" onClick={() => setScanOpen(true)}>
              <Camera className="size-4" />
              {t("dashboard.expenses.scanReceipt")}
            </Button>
            <Button size="default" className="gap-2" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              {t("dashboard.expenses.addExpense")}
            </Button>
          </div>
        }
      />

      <SectionCard noPadding>
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded-lg" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title={t("dashboard.expenses.noExpenses")}
            description={t("dashboard.expenses.noExpensesDesc")}
          />
        ) : (
          <div className="divide-y divide-border">
            <AnimatePresence mode="popLayout">
              {expenses.map((expense, i) => (
                <motion.div
                  key={expense.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: i * 0.02 }}
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-bg-elevated/50"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium text-text-primary">
                      {expense.vendor_name ?? expense.description ?? "\u2014"}
                    </span>
                    <span className="text-xs text-text-muted">
                      {format(new Date(expense.expense_date), "MMM d, yyyy")}
                    </span>
                  </div>
                  <StatusBadge status="active" label={expense.category.replace(/_/g, " ")} />
                  <span className="text-sm font-semibold text-text-primary">
                    {formatCurrency(expense.total_amount, currency)}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </SectionCard>

      {/* Add Expense Dialog */}
      <Dialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dashboard.expenses.addExpense")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Vendor / supplier</Label>
              <Input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g. Sysco Foods" />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Invoice #123, weekly order…" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label>Amount ({currency.toUpperCase()}) *</Label>
                <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div className="flex flex-col gap-2">
                <Label>Date *</Label>
                <Popover open={calOpen} onOpenChange={setCalOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="justify-start text-left font-normal">
                      {expenseDate ? format(expenseDate, "MMM d, yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={expenseDate}
                      onSelect={(d) => { setExpenseDate(d); setCalOpen(false); }}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddOpen(false); resetForm(); }}>Cancel</Button>
            <Button disabled={saving} onClick={() => void handleAdd()}>
              {saving ? "Saving…" : "Add Expense"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scan Receipt stub */}
      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent showCloseButton>
          <DialogHeader>
            <DialogTitle>{t("dashboard.expenses.scanReceipt")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <Camera className="size-12 text-text-muted" />
            <p className="text-center text-sm text-text-secondary">
              Receipt OCR coming soon. Cenaiva will automatically parse vendor, amount, and category from your receipt photos.
            </p>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </AnimatedPage>
  );
}

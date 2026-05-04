import { useCallback, useEffect, useMemo, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useUser } from "@/hooks/useUser";
import { MOCK_EXPENSES } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ExpenseCategory =
  | "food_cost"
  | "food_supplies"
  | "beverages"
  | "utilities"
  | "rent"
  | "equipment"
  | "marketing"
  | "staff"
  | "supplies"
  | "maintenance"
  | "cleaning"
  | "sales"
  | "preorders"
  | "events"
  | "catering"
  | "delivery"
  | "gift_cards"
  | "other";

export type FinanceTransactionType = "expense" | "income";
export type ExpenseStatus = "paid" | "due" | "scheduled" | "overdue";
export type ExpenseFrequency = "one_time" | "weekly" | "bi_weekly" | "monthly" | "quarterly" | "yearly";
export type RecurringExpenseFrequency = Exclude<ExpenseFrequency, "one_time">;

export type ExpenseRow = {
  id: string;
  restaurant_id: string;
  created_by?: string;
  transaction_type?: FinanceTransactionType;
  category: ExpenseCategory | string;
  vendor_name: string | null;
  description: string | null;
  notes: string | null;
  amount: number;
  tax_amount: number | null;
  total_amount: number;
  currency: string;
  expense_date: string;
  payment_status?: ExpenseStatus;
  paid_at?: string | null;
  recurring_rule_id?: string | null;
  receipt_url: string | null;
  receipt_type: string | null;
  ai_categorized: boolean;
  created_at: string | null;
  updated_at?: string | null;
  deleted_at: string | null;
};

export type RecurringExpenseRule = {
  id: string;
  restaurant_id: string;
  transaction_type?: FinanceTransactionType;
  vendor_name: string;
  category: ExpenseCategory | string;
  description: string | null;
  amount: number;
  tax_amount: number | null;
  total_amount: number;
  currency: string;
  frequency: RecurringExpenseFrequency;
  interval_count: number;
  start_date: string;
  next_due_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ExpenseFilters = {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
};

export type CreateExpensePayload = {
  transaction_type: FinanceTransactionType;
  category: ExpenseCategory;
  vendor_name: string;
  description?: string | null;
  notes?: string | null;
  amount: number;
  tax_amount?: number | null;
  total_amount: number;
  currency?: string;
  expense_date: string;
  payment_status: ExpenseStatus;
  frequency: ExpenseFrequency;
  recurring_end_date?: string | null;
};

export type UpdateExpensePayload = Omit<CreateExpensePayload, "frequency" | "recurring_end_date">;
export type UpdateRecurringExpenseRulePayload = Omit<CreateExpensePayload, "payment_status" | "notes">;

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function nextDueDate(startDate: string, frequency: ExpenseFrequency): string {
  const start = new Date(`${startDate}T12:00:00`);
  if (Number.isNaN(start.getTime())) return startDate;

  switch (frequency) {
    case "weekly":
      start.setDate(start.getDate() + 7);
      break;
    case "bi_weekly":
      start.setDate(start.getDate() + 14);
      break;
    case "monthly":
      return addMonths(start, 1).toISOString().slice(0, 10);
    case "quarterly":
      return addMonths(start, 3).toISOString().slice(0, 10);
    case "yearly":
      start.setFullYear(start.getFullYear() + 1);
      break;
    case "one_time":
      return startDate;
  }

  return start.toISOString().slice(0, 10);
}

export function useExpenses(filters?: ExpenseFilters) {
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();
  const { profile } = useUser();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [recurringRules, setRecurringRules] = useState<RecurringExpenseRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const currency = selectedRestaurant?.currency ?? "cad";

  const fetchExpenses = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setExpenses(isSupabaseConfigured() ? [] : MOCK_EXPENSES);
      setRecurringRules([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    const expenseQuery = client
      .from("expenses")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .is("deleted_at", null)
      .order("expense_date", { ascending: false });

    let query = expenseQuery;

    if (filters?.category) query = query.eq("category", filters.category);
    if (filters?.dateFrom) query = query.gte("expense_date", filters.dateFrom);
    if (filters?.dateTo) query = query.lte("expense_date", filters.dateTo);

    const recurringQuery = client
      .from("recurring_expense_rules")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .eq("is_active", true)
      .order("next_due_date", { ascending: true });

    let rulesQuery = recurringQuery;
    if (filters?.category) rulesQuery = rulesQuery.eq("category", filters.category);
    if (filters?.dateFrom) rulesQuery = rulesQuery.gte("next_due_date", filters.dateFrom);
    if (filters?.dateTo) rulesQuery = rulesQuery.lte("next_due_date", filters.dateTo);

    const [{ data, error: qErr }, { data: rulesData, error: rulesErr }] = await Promise.all([
      query,
      rulesQuery,
    ]);

    const combinedError = qErr ?? rulesErr;
    if (combinedError) {
      setError(new Error(combinedError.message));
      setExpenses([]);
      setRecurringRules([]);
    } else {
      const rows = (data ?? []) as ExpenseRow[];
      setExpenses(rows);
      setRecurringRules((rulesData ?? []) as RecurringExpenseRule[]);
    }
    setLoading(false);
  }, [selectedRestaurantId, filters?.category, filters?.dateFrom, filters?.dateTo]);

  useEffect(() => { void fetchExpenses(); }, [fetchExpenses]);

  const createExpense = useCallback(async (payload: CreateExpensePayload): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!profile?.id) return "Could not identify the current user profile.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";

    setSaving(true);
    const client = getSupabaseBrowserClient();
    let recurringRuleId: string | null = null;

    if (payload.frequency !== "one_time") {
      const rulePayload = {
        restaurant_id: selectedRestaurantId,
        transaction_type: payload.transaction_type,
        vendor_name: payload.vendor_name,
        category: payload.category,
        description: payload.description ?? null,
        amount: payload.amount,
        tax_amount: payload.tax_amount ?? 0,
        total_amount: payload.total_amount,
        currency: payload.currency ?? currency,
        frequency: payload.frequency,
        interval_count: 1,
        start_date: payload.expense_date,
        next_due_date: nextDueDate(payload.expense_date, payload.frequency),
        end_date: payload.recurring_end_date || null,
        is_active: true,
      };

      const { data: rule, error: ruleError } = await client
        .from("recurring_expense_rules")
        .insert(rulePayload)
        .select("id")
        .single();

      if (ruleError) {
        setSaving(false);
        return ruleError.message;
      }
      recurringRuleId = (rule as { id: string }).id;
    }

    const expensePayload = {
      restaurant_id: selectedRestaurantId,
      created_by: profile.id,
      transaction_type: payload.transaction_type,
      category: payload.category,
      vendor_name: payload.vendor_name,
      description: payload.description ?? null,
      notes: payload.notes ?? null,
      amount: payload.amount,
      tax_amount: payload.tax_amount ?? 0,
      total_amount: payload.total_amount,
      currency: payload.currency ?? currency,
      expense_date: payload.expense_date,
      payment_status: payload.payment_status,
      paid_at: payload.payment_status === "paid" ? new Date().toISOString() : null,
      recurring_rule_id: recurringRuleId,
    };

    const { error: insertError } = await client.from("expenses").insert(expensePayload);
    setSaving(false);

    if (insertError) {
      if (recurringRuleId) {
        await client.from("recurring_expense_rules").delete().eq("id", recurringRuleId);
      }
      return insertError.message;
    }
    await fetchExpenses();
    return null;
  }, [currency, fetchExpenses, profile?.id, selectedRestaurantId]);

  const updateExpense = useCallback(async (id: string, payload: UpdateExpensePayload): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";

    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error: updateError } = await client
      .from("expenses")
      .update({
        transaction_type: payload.transaction_type,
        category: payload.category,
        vendor_name: payload.vendor_name,
        description: payload.description ?? null,
        notes: payload.notes ?? null,
        amount: payload.amount,
        tax_amount: payload.tax_amount ?? 0,
        total_amount: payload.total_amount,
        currency: payload.currency ?? currency,
        expense_date: payload.expense_date,
        payment_status: payload.payment_status,
        paid_at: payload.payment_status === "paid" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    setSaving(false);
    if (updateError) return updateError.message;
    await fetchExpenses();
    return null;
  }, [currency, fetchExpenses, selectedRestaurantId]);

  const updateRecurringRule = useCallback(async (id: string, payload: UpdateRecurringExpenseRulePayload): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";
    if (payload.frequency === "one_time") return "Recurring bills need a recurring frequency.";

    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error: updateError } = await client
      .from("recurring_expense_rules")
      .update({
        transaction_type: payload.transaction_type,
        category: payload.category,
        vendor_name: payload.vendor_name,
        description: payload.description ?? null,
        amount: payload.amount,
        tax_amount: payload.tax_amount ?? 0,
        total_amount: payload.total_amount,
        currency: payload.currency ?? currency,
        frequency: payload.frequency,
        start_date: payload.expense_date,
        next_due_date: nextDueDate(payload.expense_date, payload.frequency),
        end_date: payload.recurring_end_date || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    setSaving(false);
    if (updateError) return updateError.message;
    await fetchExpenses();
    return null;
  }, [currency, fetchExpenses, selectedRestaurantId]);

  const deleteExpense = useCallback(async (id: string): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";

    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error: deleteError } = await client
      .from("expenses")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    setSaving(false);
    if (deleteError) return deleteError.message;
    await fetchExpenses();
    return null;
  }, [fetchExpenses, selectedRestaurantId]);

  const deleteRecurringRule = useCallback(async (id: string): Promise<string | null> => {
    if (!selectedRestaurantId) return "No restaurant selected.";
    if (!isSupabaseConfigured()) return "Supabase not configured.";

    setSaving(true);
    const client = getSupabaseBrowserClient();
    const { error: deleteError } = await client
      .from("recurring_expense_rules")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("restaurant_id", selectedRestaurantId);

    setSaving(false);
    if (deleteError) return deleteError.message;
    await fetchExpenses();
    return null;
  }, [fetchExpenses, selectedRestaurantId]);

  return useMemo(
    () => ({
      expenses,
      recurringRules,
      loading,
      saving,
      error,
      refetch: fetchExpenses,
      createExpense,
      updateExpense,
      updateRecurringRule,
      deleteExpense,
      deleteRecurringRule,
    }),
    [createExpense, deleteExpense, deleteRecurringRule, error, expenses, fetchExpenses, loading, recurringRules, saving, updateExpense, updateRecurringRule],
  );
}

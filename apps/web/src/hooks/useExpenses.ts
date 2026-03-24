import { useCallback, useEffect, useState } from "react";

import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { MOCK_EXPENSES } from "@/lib/mock-data";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

export type ExpenseRow = {
  id: string;
  restaurant_id: string;
  category: string;
  vendor_name: string | null;
  description: string | null;
  notes: string | null;
  amount: number;
  tax_amount: number | null;
  total_amount: number;
  currency: string;
  expense_date: string;
  receipt_url: string | null;
  receipt_type: string | null;
  ai_categorized: boolean;
  created_at: string | null;
  deleted_at: string | null;
};

export type ExpenseFilters = {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function useExpenses(filters?: ExpenseFilters) {
  const { selectedRestaurantId } = useRestaurantScope();
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchExpenses = useCallback(async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      setExpenses([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const client = getSupabaseBrowserClient();

    let query = client
      .from("expenses")
      .select("*")
      .eq("restaurant_id", selectedRestaurantId)
      .is("deleted_at", null)
      .order("expense_date", { ascending: false });

    if (filters?.category) query = query.eq("category", filters.category);
    if (filters?.dateFrom) query = query.gte("expense_date", filters.dateFrom);
    if (filters?.dateTo) query = query.lte("expense_date", filters.dateTo);

    const { data, error: qErr } = await query;

    if (qErr) {
      setError(new Error(qErr.message));
      setExpenses([]);
    } else {
      const rows = (data ?? []) as ExpenseRow[];
      setExpenses(rows.length > 0 ? rows : MOCK_EXPENSES);
    }
    setLoading(false);
  }, [selectedRestaurantId, filters?.category, filters?.dateFrom, filters?.dateTo]);

  useEffect(() => { void fetchExpenses(); }, [fetchExpenses]);

  return { expenses, loading, error, refetch: fetchExpenses };
}

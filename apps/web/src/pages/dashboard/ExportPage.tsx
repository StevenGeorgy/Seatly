import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDown, Download, CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { SectionCard } from "@/components/dashboard/SectionCard";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const keys = Object.keys(rows[0]);
  const header = keys.join(",");
  const body = rows.map((r) =>
    keys.map((k) => {
      const v = r[k];
      if (v === null || v === undefined) return "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    }).join(","),
  );
  return [header, ...body].join("\n");
}

function downloadCSV(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPage() {
  const { t } = useTranslation();
  const { selectedRestaurantId } = useRestaurantScope();

  const [selected, setSelected] = useState<Record<string, boolean>>({
    reservationsData: true,
    ordersData: true,
    expensesData: true,
    payrollData: false,
    analyticsData: false,
  });

  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  const inclusions = [
    { key: "reservationsData", label: t("dashboard.export.reservationsData") },
    { key: "ordersData", label: t("dashboard.export.ordersData") },
    { key: "expensesData", label: t("dashboard.export.expensesData") },
    { key: "payrollData", label: t("dashboard.export.payrollData") },
    { key: "analyticsData", label: t("dashboard.export.analyticsData") },
  ];

  const generateExport = async () => {
    if (!selectedRestaurantId || !isSupabaseConfigured()) {
      toast.error("No restaurant selected.");
      return;
    }

    setGenerating(true);
    const client = getSupabaseBrowserClient();
    const from = fromDate ? fromDate.toISOString() : undefined;
    const to = toDate ? toDate.toISOString() : undefined;
    let exported = 0;

    try {
      if (selected.reservationsData) {
        let q = client
          .from("reservations")
          .select("id, status, reserved_at, party_size, confirmation_code, guest_full_name, guest_email, guest_phone, source, special_request, created_at")
          .eq("restaurant_id", selectedRestaurantId)
          .order("reserved_at", { ascending: false });
        if (from) q = q.gte("reserved_at", from);
        if (to) q = q.lte("reserved_at", to);
        const { data, error } = await q;
        if (error) throw error;
        downloadCSV("reservations.csv", toCSV((data ?? []) as Record<string, unknown>[]));
        exported++;
      }

      if (selected.ordersData) {
        let q = client
          .from("orders")
          .select("id, status, order_type, total_amount, confirmation_code, created_at")
          .eq("restaurant_id", selectedRestaurantId)
          .order("created_at", { ascending: false });
        if (from) q = q.gte("created_at", from);
        if (to) q = q.lte("created_at", to);
        const { data, error } = await q;
        if (error) throw error;
        downloadCSV("orders.csv", toCSV((data ?? []) as Record<string, unknown>[]));
        exported++;
      }

      if (selected.expensesData) {
        let q = client
          .from("expenses")
          .select("id, vendor_name, description, category, total_amount, expense_date, created_at")
          .eq("restaurant_id", selectedRestaurantId)
          .order("expense_date", { ascending: false });
        if (from) q = q.gte("expense_date", from);
        if (to) q = q.lte("expense_date", to);
        const { data, error } = await q;
        if (error) throw error;
        downloadCSV("expenses.csv", toCSV((data ?? []) as Record<string, unknown>[]));
        exported++;
      }

      if (selected.payrollData) {
        const { data, error } = await client
          .from("user_restaurant_roles")
          .select("id, role, employment_type, hourly_rate, user_profiles(full_name, email)")
          .eq("restaurant_id", selectedRestaurantId);
        if (error) throw error;
        const flat = ((data ?? []) as Record<string, unknown>[]).map((row) => {
          const up = row.user_profiles as Record<string, unknown> | null;
          return { id: row.id, role: row.role, employment_type: row.employment_type, hourly_rate: row.hourly_rate, full_name: up?.full_name ?? "", email: up?.email ?? "" };
        });
        downloadCSV("payroll.csv", toCSV(flat));
        exported++;
      }

      if (selected.analyticsData) {
        const { data, error } = await client
          .from("reservations")
          .select("status, party_size, reserved_at, no_show_risk_score")
          .eq("restaurant_id", selectedRestaurantId);
        if (error) throw error;
        downloadCSV("analytics.csv", toCSV((data ?? []) as Record<string, unknown>[]));
        exported++;
      }

      if (exported === 0) {
        toast.error("Select at least one dataset to export.");
      } else {
        toast.success(`${exported} file${exported > 1 ? "s" : ""} exported.`);
      }
    } catch (err) {
      toast.error("Export failed: " + (err instanceof Error ? err.message : "unknown error"));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader title={t("dashboard.export.title")} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title={t("dashboard.export.generate")}>
          <div className="flex flex-col gap-5">
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                {t("dashboard.export.includes")}
              </p>
              <div className="flex flex-col gap-3">
                {inclusions.map((inc) => (
                  <div key={inc.key} className="flex items-center gap-3">
                    <Checkbox
                      id={inc.key}
                      checked={selected[inc.key] ?? false}
                      onCheckedChange={(v) =>
                        setSelected((prev) => ({ ...prev, [inc.key]: Boolean(v) }))
                      }
                    />
                    <Label htmlFor={inc.key} className="text-sm text-text-secondary">
                      {inc.label}
                    </Label>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                Date Range (optional)
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Popover open={fromOpen} onOpenChange={setFromOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <CalendarDays className="size-3.5" />
                      {fromDate ? format(fromDate, "MMM d, yyyy") : "From"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={fromDate}
                      onSelect={(d) => { setFromDate(d); setFromOpen(false); }}
                    />
                  </PopoverContent>
                </Popover>
                <span className="text-xs text-text-muted">to</span>
                <Popover open={toOpen} onOpenChange={setToOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <CalendarDays className="size-3.5" />
                      {toDate ? format(toDate, "MMM d, yyyy") : "To"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={toDate}
                      onSelect={(d) => { setToDate(d); setToOpen(false); }}
                    />
                  </PopoverContent>
                </Popover>
                {(fromDate || toDate) && (
                  <Button variant="ghost" size="sm" onClick={() => { setFromDate(undefined); setToDate(undefined); }}>
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <Button
              className="w-full gap-2"
              disabled={generating || !selectedRestaurantId}
              onClick={() => void generateExport()}
            >
              <Download className="size-4" />
              {generating ? "Generating…" : t("dashboard.export.generate")}
            </Button>
          </div>
        </SectionCard>

        <SectionCard title={t("dashboard.export.previousExports")}>
          <EmptyState
            icon={<FileDown className="size-5" />}
            title={t("dashboard.export.noExports")}
            description={t("dashboard.export.noExportsDesc")}
          />
        </SectionCard>
      </div>
    </AnimatedPage>
  );
}

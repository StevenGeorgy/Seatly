import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDown, Download, CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useErrorToast } from "@/lib/errors";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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

function ExportDateButton({
  value,
  onChange,
  placeholder,
  clearLabel,
  disabledBefore,
  disabledAfter,
  anchorDate,
}: {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder: string;
  clearLabel: string;
  disabledBefore?: Date;
  disabledAfter?: Date;
  anchorDate?: Date;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 min-w-32 cursor-pointer items-center rounded-lg border border-border bg-bg-elevated pl-9 pr-3 text-left outline-none transition-colors hover:border-gold/30 focus-visible:ring-2 focus-visible:ring-gold/40"
        >
          <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
          <span className={cn("truncate text-xs leading-none", value ? "text-text-primary" : "text-text-muted")}>
            {value ? format(value, "MMM d, yyyy") : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto border-border bg-bg-elevated p-2 text-text-primary shadow-2xl">
        <Calendar
          mode="single"
          required={false}
          showOutsideDays={false}
          selected={value}
          modifiers={anchorDate ? { anchor: anchorDate } : undefined}
          onSelect={(date) => {
            onChange(date);
            if (date) setOpen(false);
          }}
          disabled={disabledBefore ? { before: disabledBefore } : disabledAfter ? { after: disabledAfter } : undefined}
          classNames={{
            day: "group/day relative flex-1 p-0 text-center select-none",
            day_button: "relative isolate z-10 flex size-9 min-w-9 items-center justify-center rounded-md border-0 leading-none font-normal text-text-secondary hover:bg-gold/10 hover:text-white disabled:pointer-events-none disabled:opacity-30 data-[selected-single=true]:bg-gold data-[selected-single=true]:font-semibold data-[selected-single=true]:text-black data-[anchor=true]:border data-[anchor=true]:border-gold/60 data-[anchor=true]:text-gold",
            hidden: "invisible pointer-events-none",
            outside: "invisible pointer-events-none",
            disabled: "text-text-muted opacity-25",
            today: "text-white",
          }}
          className="rounded-md border-0 bg-transparent"
        />
        {value && (
          <div className="border-t border-border pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-text-secondary hover:bg-bg-surface hover:text-text-primary"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              {clearLabel}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function ExportPage() {
  const { t } = useTranslation();
  const { errorToast } = useErrorToast();
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
  const [generating, setGenerating] = useState(false);

  const inclusions = [
    { key: "reservationsData", label: t("dashboard.export.reservationsData") },
    { key: "ordersData", label: t("dashboard.export.ordersData") },
    { key: "expensesData", label: t("dashboard.export.expensesData") },
    { key: "payrollData", label: t("dashboard.export.payrollData") },
    { key: "analyticsData", label: t("dashboard.export.analyticsData") },
  ];
  const selectedCount = inclusions.filter((inc) => selected[inc.key]).length;

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
      errorToast(err, {
        fallback: "Couldn't generate that export. Try again in a moment.",
        logTag: "[ExportPage.generateExport]",
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          <FileDown className="size-3.5" />
          {t("dashboard.export.title")}
        </p>
        <h1 className="font-serif text-3xl text-white sm:text-4xl">{t("dashboard.export.title")}</h1>
        <p className="max-w-2xl text-sm italic text-text-muted">
          {t("dashboard.export.subtitle")}
        </p>
      </header>

      <section className="grid gap-5 lg:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.05fr)]">
        <article className="overflow-hidden rounded-2xl border border-border bg-bg-surface">
          <div className="border-b border-border/60 px-5 py-5 lg:px-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-2xl text-white">{t("dashboard.export.generate")}</h2>
                <p className="mt-1 text-xs text-text-muted">
                  {selectedCount} {t("dashboard.export.selectedDatasets")}
                </p>
              </div>
              <div className="rounded-full border border-gold/20 bg-gold/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-gold">
                {t("dashboard.export.csv")}
              </div>
            </div>
          </div>

          <div className="grid gap-6 p-5 lg:p-6">
            <div>
              <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {t("dashboard.export.includes")}
              </p>
              <div className="grid gap-2">
                {inclusions.map((inc) => {
                  const checked = selected[inc.key] ?? false;
                  return (
                    <Label
                      key={inc.key}
                      htmlFor={inc.key}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition-colors",
                        checked
                          ? "border-gold/30 bg-gold/10 text-white"
                          : "border-border bg-bg-elevated/35 text-text-secondary hover:border-gold/20 hover:bg-bg-elevated/60",
                      )}
                    >
                      <Checkbox
                        id={inc.key}
                        checked={checked}
                        onCheckedChange={(v) =>
                          setSelected((prev) => ({ ...prev, [inc.key]: Boolean(v) }))
                        }
                      />
                      <span className="min-w-0 flex-1 text-sm">{inc.label}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                        {checked ? t("dashboard.export.included") : t("dashboard.export.off")}
                      </span>
                    </Label>
                  );
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-bg-elevated/35 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                {t("dashboard.export.dateRange")} ({t("dashboard.export.optional")})
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <ExportDateButton
                  value={fromDate}
                  onChange={(date) => {
                    setFromDate(date);
                    if (date && toDate && toDate < date) setToDate(undefined);
                  }}
                  placeholder={t("dashboard.export.from")}
                  clearLabel={t("dashboard.export.clearDate")}
                  disabledAfter={toDate}
                  anchorDate={toDate}
                />
                <span className="text-xs text-text-muted">{t("dashboard.export.to").toLowerCase()}</span>
                <ExportDateButton
                  value={toDate}
                  onChange={setToDate}
                  placeholder={t("dashboard.export.to")}
                  clearLabel={t("dashboard.export.clearDate")}
                  disabledBefore={fromDate}
                  anchorDate={fromDate}
                />
                {(fromDate || toDate) && (
                  <Button variant="ghost" size="sm" onClick={() => { setFromDate(undefined); setToDate(undefined); }}>
                    {t("dashboard.export.clear")}
                  </Button>
                )}
              </div>
            </div>

            <Button
              className="h-12 w-full gap-2 rounded-xl font-semibold"
              disabled={generating || !selectedRestaurantId}
              onClick={() => void generateExport()}
            >
              <Download className="size-4" />
              {generating ? t("dashboard.export.generating") : t("dashboard.export.generate")}
            </Button>
          </div>
        </article>

        <article className="flex min-h-[420px] flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface">
          <div className="border-b border-border/60 px-5 py-5 lg:px-6">
            <h2 className="font-serif text-2xl text-white">{t("dashboard.export.previousExports")}</h2>
            <p className="mt-1 text-xs text-text-muted">
              {t("dashboard.export.previousExportsDesc")}
            </p>
          </div>
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="mx-auto max-w-sm text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border bg-bg-elevated/60 text-gold">
                <FileDown className="size-5" />
              </div>
              <h3 className="mt-5 font-serif text-xl text-white">{t("dashboard.export.noExports")}</h3>
              <p className="mt-2 text-sm text-text-muted">{t("dashboard.export.noExportsDesc")}</p>
            </div>
          </div>
        </article>
      </section>
    </AnimatedPage>
  );
}

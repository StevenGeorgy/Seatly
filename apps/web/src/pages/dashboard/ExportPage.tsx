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
    revenueData: true,
    reservationsData: true,
    ordersData: true,
    expensesData: true,
    payrollData: false,
    analyticsData: false,
    cenaivaBillingData: false,
  });

  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [generating, setGenerating] = useState(false);

  const inclusions = [
    { key: "revenueData", label: "Revenue (paid orders + deposits)" },
    { key: "reservationsData", label: t("dashboard.export.reservationsData") },
    { key: "ordersData", label: t("dashboard.export.ordersData") },
    { key: "expensesData", label: t("dashboard.export.expensesData") },
    { key: "payrollData", label: t("dashboard.export.payrollData") },
    { key: "analyticsData", label: t("dashboard.export.analyticsData") },
    { key: "cenaivaBillingData", label: "Cenaiva billing statements" },
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
      if (selected.revenueData) {
        // Revenue = everything the restaurant has actually been paid for,
        // unified across two source tables so the accountant gets one
        // chronological income ledger:
        //
        //   1. `orders` — POS dine-in, online orders, and pre-orders
        //      (`is_preorder=true`). Only rows with `paid_at IS NOT NULL`
        //      count, since unpaid/cancelled orders aren't income.
        //   2. `reservation_deposit_payments` — diner-paid deposits at
        //      booking time (one row per payer, supports split-pay).
        //      Only `status='charged'` rows count.
        //
        // Date filter applies to `paid_at` for both, since the accountant
        // cares about when money landed, not when the row was created.
        // Under the Option B fee model (see STRIPE_UPDATES.md): both
        // the 2% platform fee and Stripe processing are paid by the
        // diner on top of the base. The amount_cents / total_amount
        // values below ARE the restaurant's net — 100% of the deposit
        // or order base — no commission or Stripe deduction needed.
        let oq = client
          .from("orders")
          .select("id, reservation_id, paid_at, billed_at, created_at, order_type, is_preorder, source, payment_method, status, subtotal, tax_amount, tip_amount, total_amount, discount_amount, confirmation_code, stripe_payment_intent_id")
          .eq("restaurant_id", selectedRestaurantId)
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: false });
        if (from) oq = oq.gte("paid_at", from);
        if (to) oq = oq.lte("paid_at", to);
        const { data: paidOrders, error: ordersErr } = await oq;
        if (ordersErr) throw ordersErr;

        let dq = client
          .from("reservation_deposit_payments")
          .select("id, reservation_id, payer_full_name, payer_email, amount_cents, status, stripe_payment_intent_id, paid_at, created_at")
          .eq("status", "charged")
          .not("paid_at", "is", null)
          .order("paid_at", { ascending: false });
        if (from) dq = dq.gte("paid_at", from);
        if (to) dq = dq.lte("paid_at", to);
        // reservation_deposit_payments has no restaurant_id column —
        // RLS already scopes to rows the caller can see, but we want to
        // be explicit about which restaurant's deposits these are. Use
        // an inner-join via PostgREST so unrelated rows are filtered
        // server-side rather than client-side.
        const { data: depositRows, error: depErr } = await dq;
        if (depErr) throw depErr;
        const depositReservationIds = Array.from(
          new Set(
            ((depositRows ?? []) as Array<{ reservation_id: string | null }>)
              .map((r) => r.reservation_id)
              .filter((id): id is string => Boolean(id)),
          ),
        );
        let ownReservationIds = new Set<string>();
        if (depositReservationIds.length > 0) {
          const { data: scopedRes, error: scopedErr } = await client
            .from("reservations")
            .select("id")
            .eq("restaurant_id", selectedRestaurantId)
            .in("id", depositReservationIds);
          if (scopedErr) throw scopedErr;
          ownReservationIds = new Set(
            ((scopedRes ?? []) as Array<{ id: string }>).map((r) => r.id),
          );
        }

        type OrderRow = {
          id: string;
          reservation_id: string | null;
          paid_at: string | null;
          billed_at: string | null;
          created_at: string | null;
          order_type: string | null;
          is_preorder: boolean | null;
          source: string | null;
          payment_method: string | null;
          status: string | null;
          subtotal: number | string | null;
          tax_amount: number | string | null;
          tip_amount: number | string | null;
          total_amount: number | string | null;
          discount_amount: number | string | null;
          confirmation_code: string | null;
          stripe_payment_intent_id: string | null;
        };
        type DepositRow = {
          id: string;
          reservation_id: string | null;
          payer_full_name: string | null;
          payer_email: string | null;
          amount_cents: number | null;
          status: string | null;
          stripe_payment_intent_id: string | null;
          paid_at: string | null;
          created_at: string | null;
        };
        const toDollars = (cents: number | null | undefined): number =>
          typeof cents === "number" ? Math.round(cents) / 100 : 0;
        const orderRows = ((paidOrders ?? []) as OrderRow[]).map((o) => ({
          paid_at: o.paid_at ?? "",
          source: o.is_preorder
            ? "preorder"
            : o.order_type === "pos" || o.order_type === "dine_in"
              ? "order_dinein"
              : o.order_type
                ? `order_${o.order_type}`
                : "order",
          gross_amount: o.total_amount ?? 0,
          subtotal: o.subtotal ?? 0,
          tax_amount: o.tax_amount ?? 0,
          tip_amount: o.tip_amount ?? 0,
          discount_amount: o.discount_amount ?? 0,
          currency: "cad",
          payer: "",
          reference: o.confirmation_code ?? o.id,
          reservation_id: o.reservation_id ?? "",
          order_id: o.id,
          deposit_payment_id: "",
          status: o.status ?? "",
          payment_method: o.payment_method ?? "",
          stripe_payment_intent_id: o.stripe_payment_intent_id ?? "",
          created_at: o.created_at ?? "",
        }));
        const depositRowsFiltered = ((depositRows ?? []) as DepositRow[])
          .filter((d) => d.reservation_id && ownReservationIds.has(d.reservation_id))
          .map((d) => ({
            paid_at: d.paid_at ?? "",
            source: "deposit",
            gross_amount: toDollars(d.amount_cents),
            subtotal: toDollars(d.amount_cents),
            tax_amount: 0,
            tip_amount: 0,
            discount_amount: 0,
            currency: "cad",
            payer: d.payer_full_name ?? d.payer_email ?? "",
            reference: d.stripe_payment_intent_id ?? d.id,
            reservation_id: d.reservation_id ?? "",
            order_id: "",
            deposit_payment_id: d.id,
            status: d.status ?? "",
            payment_method: "card",
            stripe_payment_intent_id: d.stripe_payment_intent_id ?? "",
            created_at: d.created_at ?? "",
          }));
        const revenueRows = [...orderRows, ...depositRowsFiltered].sort((a, b) =>
          (b.paid_at ?? "").localeCompare(a.paid_at ?? ""),
        );
        downloadCSV("revenue.csv", toCSV(revenueRows as Record<string, unknown>[]));
        exported++;
      }

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

      if (selected.cenaivaBillingData) {
        // Year-end tax doc export. Pulls only the auto-imported Cenaiva
        // charges from the expenses table (subscription + booking fees).
        // Owner hands this CSV to their accountant alongside the
        // Stripe-hosted invoice PDFs from Settings → Billing.
        let q = client
          .from("expenses")
          .select("expense_date, description, total_amount, currency, external_ref, paid_at")
          .eq("restaurant_id", selectedRestaurantId)
          .eq("source", "auto:cenaiva")
          .order("expense_date", { ascending: false });
        if (from) q = q.gte("expense_date", from.slice(0, 10));
        if (to) q = q.lte("expense_date", to.slice(0, 10));
        const { data, error } = await q;
        if (error) throw error;
        const rows = (data ?? []).map((r) => {
          const row = r as {
            expense_date: string;
            description: string | null;
            total_amount: number | string | null;
            currency: string | null;
            external_ref: string | null;
            paid_at: string | null;
          };
          const desc = row.description ?? "";
          const lineType = desc.toLowerCase().includes("booking")
            ? "booking_fees"
            : "subscription";
          return {
            date: row.expense_date,
            type: lineType,
            description: desc,
            amount_cad: row.total_amount ?? 0,
            currency: row.currency ?? "cad",
            invoice_id: row.external_ref ?? "",
            paid_at: row.paid_at ?? "",
          };
        });
        downloadCSV("cenaiva-billing.csv", toCSV(rows as Record<string, unknown>[]));
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

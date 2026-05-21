// BillingDetailsForm — in-app self-service form for the legal entity name,
// billing email, address, and tax ID that appear on Cenaiva invoices.
// Replaces the previous "Open billing portal" → Stripe redirect.
//
// Loads from the locally-mirrored restaurants row (already in
// useStaffRestaurants SELECT). Saves via update-billing-details edge fn
// which updates Stripe customer + reconciles tax IDs + mirrors back to DB.

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import type { StaffRestaurantRow } from "@/hooks/useStaffRestaurants";

interface BillingDetailsFormProps {
  restaurant: StaffRestaurantRow;
  onSaved?: () => void;
  className?: string;
}

// Canadian tax ID types Stripe supports. Most restaurants use ca_gst_hst.
const TAX_ID_TYPES = [
  { value: "", label: "No tax ID" },
  { value: "ca_gst_hst", label: "GST/HST (Federal)" },
  { value: "ca_qst", label: "QST (Quebec)" },
  { value: "ca_pst_bc", label: "PST (British Columbia)" },
  { value: "ca_pst_mb", label: "PST (Manitoba)" },
  { value: "ca_pst_sk", label: "PST (Saskatchewan)" },
] as const;

const PROVINCES = [
  "ON", "QC", "BC", "AB", "MB", "SK", "NS", "NB", "NL", "PE", "YT", "NT", "NU",
];

// Canadian postal code: A1A 1A1 (with optional space).
const CA_POSTAL = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;
// GST/HST: 9 digits + "RT" + 4 digits (or 9 digits only — backward-compat).
const CA_GST_HST = /^\d{9}( ?RT\d{4})?$/;

export function BillingDetailsForm({
  restaurant,
  onSaved,
  className,
}: BillingDetailsFormProps) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);

  // Pre-fill billing fields from the restaurant record when the owner
  // hasn't set a billing-specific value yet. Owners can still override —
  // e.g. legal name "1234567 Ontario Inc." vs operating name "Qoop", or
  // an accounting@... billing email separate from the owner login. Tax
  // ID is the one field that's never duplicated.
  const initial = useMemo(
    () => ({
      legal_name: restaurant.billing_legal_name ?? restaurant.name ?? "",
      billing_email: restaurant.billing_email ?? restaurant.email ?? "",
      address_line1: restaurant.billing_address_line1 ?? restaurant.address ?? "",
      address_line2: restaurant.billing_address_line2 ?? "",
      address_city: restaurant.billing_address_city ?? restaurant.city ?? "",
      address_province: restaurant.billing_address_province ?? restaurant.province ?? "ON",
      address_postal_code: restaurant.billing_address_postal_code ?? "",
      address_country: restaurant.billing_address_country
        ?? (restaurant.country?.toLowerCase() === "canada" ? "CA" : "CA"),
      tax_id_type: restaurant.billing_tax_id_type ?? "",
      tax_id_value: restaurant.billing_tax_id_value ?? "",
    }),
    [restaurant],
  );

  const [form, setForm] = useState(initial);
  useEffect(() => {
    setForm(initial);
  }, [initial]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): string | null {
    if (form.address_postal_code && !CA_POSTAL.test(form.address_postal_code)) {
      return "Postal code must look like A1A 1A1.";
    }
    if (form.tax_id_type === "ca_gst_hst" && form.tax_id_value && !CA_GST_HST.test(form.tax_id_value)) {
      return "GST/HST number should be 9 digits (optionally followed by RT0001).";
    }
    if (form.tax_id_type && !form.tax_id_value.trim()) {
      return "Tax ID number is required when a tax type is selected.";
    }
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    if (!isSupabaseConfigured()) {
      toast.error("Supabase is not configured.");
      return;
    }
    setSaving(true);
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Your session expired. Please sign in again.");
        setSaving(false);
        return;
      }

      const body = {
        restaurant_id: restaurant.id,
        legal_name: form.legal_name.trim() || null,
        billing_email: form.billing_email.trim() || null,
        address: {
          line1: form.address_line1.trim() || null,
          line2: form.address_line2.trim() || null,
          city: form.address_city.trim() || null,
          province: form.address_province.trim() || null,
          postal_code: form.address_postal_code.trim() || null,
          country: form.address_country.trim() || "CA",
        },
        tax_id: form.tax_id_type
          ? { type: form.tax_id_type, value: form.tax_id_value.trim() }
          : null,
      };

      const res = await fetch(
        `${getSupabaseProjectUrl()}/functions/v1/update-billing-details`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: getSupabaseAnonKey(),
          },
          body: JSON.stringify(body),
        },
      );
      const respBody = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok || respBody?.error) {
        toast.error(respBody?.error ?? "Couldn't save billing details.");
        return;
      }
      toast.success("Billing details saved.");
      onSaved?.();
      setExpanded(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`rounded-xl border border-border bg-bg-surface/40 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
        aria-controls="billing-details-form"
      >
        <div>
          <h4 className="text-sm font-medium text-text-primary">Billing details</h4>
          <p className="mt-0.5 text-xs text-text-muted">
            Legal name, address, and tax ID shown on your monthly Cenaiva invoice.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="size-4 text-text-muted" />
        ) : (
          <ChevronDown className="size-4 text-text-muted" />
        )}
      </button>

      {expanded ? (
        <form
          id="billing-details-form"
          onSubmit={(e) => void handleSubmit(e)}
          className="space-y-4 border-t border-border px-4 py-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="legal_name">Legal name</Label>
              <Input
                id="legal_name"
                value={form.legal_name}
                onChange={(e) => set("legal_name", e.target.value)}
                placeholder="1234567 Ontario Inc."
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="billing_email">Billing email</Label>
              <Input
                id="billing_email"
                type="email"
                value={form.billing_email}
                onChange={(e) => set("billing_email", e.target.value)}
                placeholder="accounting@example.com"
                disabled={saving}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="address_line1">Street address</Label>
            <Input
              id="address_line1"
              value={form.address_line1}
              onChange={(e) => set("address_line1", e.target.value)}
              placeholder="123 King St W"
              disabled={saving}
            />
          </div>
          <div>
            <Label htmlFor="address_line2">Unit / suite (optional)</Label>
            <Input
              id="address_line2"
              value={form.address_line2}
              onChange={(e) => set("address_line2", e.target.value)}
              placeholder="Suite 200"
              disabled={saving}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="address_city">City</Label>
              <Input
                id="address_city"
                value={form.address_city}
                onChange={(e) => set("address_city", e.target.value)}
                placeholder="Toronto"
                disabled={saving}
              />
            </div>
            <div>
              <Label htmlFor="address_province">Province</Label>
              <Select
                value={form.address_province}
                onValueChange={(v) => set("address_province", v)}
                disabled={saving}
              >
                <SelectTrigger id="address_province">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVINCES.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="address_postal_code">Postal code</Label>
              <Input
                id="address_postal_code"
                value={form.address_postal_code}
                onChange={(e) =>
                  set("address_postal_code", e.target.value.toUpperCase())
                }
                placeholder="M5H 1J9"
                disabled={saving}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tax_id_type">Tax ID type</Label>
              <Select
                value={form.tax_id_type || "none"}
                onValueChange={(v) => set("tax_id_type", v === "none" ? "" : v)}
                disabled={saving}
              >
                <SelectTrigger id="tax_id_type">
                  <SelectValue placeholder="No tax ID" />
                </SelectTrigger>
                <SelectContent>
                  {TAX_ID_TYPES.map((t) => (
                    <SelectItem key={t.value || "none"} value={t.value || "none"}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="tax_id_value">Tax ID number</Label>
              <Input
                id="tax_id_value"
                value={form.tax_id_value}
                onChange={(e) => set("tax_id_value", e.target.value)}
                placeholder={
                  form.tax_id_type === "ca_gst_hst"
                    ? "123456789 RT0001"
                    : "Number"
                }
                disabled={saving || !form.tax_id_type}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setForm(initial);
                setExpanded(false);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-1.5">
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {saving ? "Saving…" : "Save details"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

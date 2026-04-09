import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Tag, Plus, Pencil, Trash2, X, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  usePromotions,
  getPromotionLabel,
  getPromoTypeBadgeClasses,
  type PromotionRow,
  type CreatePromotionPayload,
  type PromoType,
  type BadgeColor,
} from "@/hooks/usePromotions";

type FormState = {
  title: string;
  description: string;
  promo_type: PromoType;
  discount_value: string;
  discount_unit: "percent" | "dollar";
  applies_to: "all" | "dine_in" | "pickup" | "delivery";
  min_order_amount: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  promo_code: string;
  max_uses: string;
  badge_color: BadgeColor;
};

const DEFAULT_FORM: FormState = {
  title: "",
  description: "",
  promo_type: "percentage",
  discount_value: "",
  discount_unit: "percent",
  applies_to: "all",
  min_order_amount: "",
  starts_at: new Date().toISOString().slice(0, 16),
  ends_at: "",
  is_active: true,
  promo_code: "",
  max_uses: "",
  badge_color: "amber",
};

function promoStatus(p: PromotionRow): "active" | "expired" | "scheduled" | "paused" {
  if (!p.is_active) return "paused";
  const now = new Date();
  if (new Date(p.starts_at) > now) return "scheduled";
  if (p.ends_at && new Date(p.ends_at) < now) return "expired";
  return "active";
}

function StatusPill({ status }: { status: ReturnType<typeof promoStatus> }) {
  const map = {
    active: { label: "Active", classes: "bg-green-500/15 text-green-400" },
    expired: { label: "Expired", classes: "bg-red-500/15 text-red-400" },
    scheduled: { label: "Scheduled", classes: "bg-blue-500/15 text-blue-400" },
    paused: { label: "Paused", classes: "bg-bg-elevated text-text-muted" },
  };
  const { label, classes } = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${classes}`}>
      {label}
    </span>
  );
}

function PromoFormDrawer({
  open,
  onClose,
  onSave,
  saving,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (form: FormState) => Promise<void>;
  saving: boolean;
  initial: FormState;
}) {
  const [form, setForm] = useState<FormState>(initial);

  // Reset when drawer opens with new initial
  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const showDiscountValue = form.promo_type === "percentage" || form.promo_type === "fixed";

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />
          {/* Drawer */}
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-bg-surface shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-text-primary">
                {initial.title ? "Edit Promotion" : "New Promotion"}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Form */}
            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="promo-title">Title *</Label>
                <Input
                  id="promo-title"
                  placeholder="e.g. BOGO Pasta, 20% Off Weekend"
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                />
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="promo-desc">Description</Label>
                <textarea
                  id="promo-desc"
                  rows={2}
                  placeholder="e.g. Valid on all pasta dishes, dine-in only"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  className="min-h-[60px] w-full rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-gold/40 resize-none"
                />
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1.5">
                <Label>Deal Type *</Label>
                <Select value={form.promo_type} onValueChange={(v) => set("promo_type", v as PromoType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bogo">BOGO — Buy One Get One</SelectItem>
                    <SelectItem value="percentage">Percentage Off</SelectItem>
                    <SelectItem value="fixed">Fixed Amount Off</SelectItem>
                    <SelectItem value="free_item">Free Item / Surprise Offer</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Discount value (only for percentage / fixed) */}
              {showDiscountValue && (
                <div className="flex gap-3">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="promo-val">
                      {form.promo_type === "percentage" ? "Discount %" : "Discount Amount"}
                    </Label>
                    <Input
                      id="promo-val"
                      type="number"
                      min={0}
                      placeholder={form.promo_type === "percentage" ? "20" : "5.00"}
                      value={form.discount_value}
                      onChange={(e) => set("discount_value", e.target.value)}
                    />
                  </div>
                  {form.promo_type === "fixed" && (
                    <div className="flex flex-col gap-1.5">
                      <Label>Unit</Label>
                      <Select value={form.discount_unit} onValueChange={(v) => set("discount_unit", v as "percent" | "dollar")}>
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dollar">$ Dollar</SelectItem>
                          <SelectItem value="percent">% Percent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}

              {/* Applies to */}
              <div className="flex flex-col gap-1.5">
                <Label>Applies To</Label>
                <Select value={form.applies_to} onValueChange={(v) => set("applies_to", v as FormState["applies_to"])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All order types</SelectItem>
                    <SelectItem value="dine_in">Dine-In only</SelectItem>
                    <SelectItem value="pickup">Pickup only</SelectItem>
                    <SelectItem value="delivery">Delivery only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-starts">Starts At</Label>
                  <Input
                    id="promo-starts"
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => set("starts_at", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-ends">Ends At</Label>
                  <Input
                    id="promo-ends"
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(e) => set("ends_at", e.target.value)}
                  />
                </div>
              </div>

              {/* Optional fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-code">Promo Code</Label>
                  <Input
                    id="promo-code"
                    placeholder="e.g. SAVE20"
                    value={form.promo_code}
                    onChange={(e) => set("promo_code", e.target.value.toUpperCase())}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="promo-max">Max Uses</Label>
                  <Input
                    id="promo-max"
                    type="number"
                    min={1}
                    placeholder="Unlimited"
                    value={form.max_uses}
                    onChange={(e) => set("max_uses", e.target.value)}
                  />
                </div>
              </div>

              {/* Min order amount */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="promo-min">Minimum Order Amount</Label>
                <Input
                  id="promo-min"
                  type="number"
                  min={0}
                  placeholder="No minimum"
                  value={form.min_order_amount}
                  onChange={(e) => set("min_order_amount", e.target.value)}
                />
              </div>

              {/* Badge color */}
              <div className="flex flex-col gap-1.5">
                <Label>Badge Color</Label>
                <div className="flex gap-2">
                  {(["amber", "green", "red", "blue"] as BadgeColor[]).map((c) => {
                    const colorMap: Record<BadgeColor, string> = {
                      amber: "bg-amber-500",
                      green: "bg-green-500",
                      red: "bg-red-500",
                      blue: "bg-blue-500",
                    };
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => set("badge_color", c)}
                        className={`size-7 rounded-full border-2 transition-all ${colorMap[c]} ${
                          form.badge_color === c ? "border-white scale-110" : "border-transparent"
                        }`}
                        aria-label={c}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="promo-active"
                  checked={form.is_active}
                  onChange={(e) => set("is_active", e.target.checked)}
                  className="size-4 rounded border-border accent-gold"
                />
                <Label htmlFor="promo-active" className="cursor-pointer">
                  Active (visible to customers)
                </Label>
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-border px-5 py-4">
              <Button
                className="w-full gap-2"
                disabled={saving || !form.title.trim()}
                onClick={() => void onSave(form)}
              >
                {saving ? "Saving..." : "Save Promotion"}
              </Button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default function PromotionsPage() {
  const { t } = useTranslation();
  const { promotions, loading, saving, createPromotion, updatePromotion, deletePromotion } = usePromotions();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PromotionRow | null>(null);

  const initialForm = editTarget
    ? {
        title: editTarget.title,
        description: editTarget.description ?? "",
        promo_type: editTarget.promo_type,
        discount_value: editTarget.discount_value?.toString() ?? "",
        discount_unit: editTarget.discount_unit ?? "percent",
        applies_to: editTarget.applies_to,
        min_order_amount: editTarget.min_order_amount?.toString() ?? "",
        starts_at: editTarget.starts_at.slice(0, 16),
        ends_at: editTarget.ends_at?.slice(0, 16) ?? "",
        is_active: editTarget.is_active,
        promo_code: editTarget.promo_code ?? "",
        max_uses: editTarget.max_uses?.toString() ?? "",
        badge_color: editTarget.badge_color,
      }
    : DEFAULT_FORM;

  const openCreate = () => {
    setEditTarget(null);
    setDrawerOpen(true);
  };

  const openEdit = (p: PromotionRow) => {
    setEditTarget(p);
    setDrawerOpen(true);
  };

  const handleSave = async (form: FormState) => {
    const payload: CreatePromotionPayload = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      promo_type: form.promo_type,
      discount_value: form.discount_value ? Number(form.discount_value) : null,
      discount_unit: form.discount_value ? form.discount_unit : null,
      applies_to: form.applies_to,
      min_order_amount: form.min_order_amount ? Number(form.min_order_amount) : null,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      is_active: form.is_active,
      promo_code: form.promo_code.trim() || null,
      max_uses: form.max_uses ? Number(form.max_uses) : null,
      badge_color: form.badge_color,
    };

    const ok = editTarget
      ? await updatePromotion(editTarget.id, payload)
      : await createPromotion(payload);

    if (ok) {
      toast.success(editTarget ? "Promotion updated" : "Promotion created");
      setDrawerOpen(false);
      setEditTarget(null);
    } else {
      toast.error("Could not save promotion. Try again.");
    }
  };

  const handleDelete = async (p: PromotionRow) => {
    if (!confirm(`Delete "${p.title}"?`)) return;
    const ok = await deletePromotion(p.id);
    if (ok) toast.success("Promotion deleted");
    else toast.error("Could not delete promotion.");
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.promotions.title")}
        actions={
          <Button size="default" className="gap-2" onClick={openCreate}>
            <Plus className="size-4" />
            {t("dashboard.promotions.create")}
          </Button>
        }
      />

      {loading ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : promotions.length === 0 ? (
        <EmptyState
          icon={<Tag className="size-5" />}
          title={t("dashboard.promotions.noPromos")}
          description={t("dashboard.promotions.noPromosDesc")}
          action={
            <Button size="default" className="gap-2" onClick={openCreate}>
              <Plus className="size-4" />
              {t("dashboard.promotions.create")}
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {promotions.map((p, i) => {
            const status = promoStatus(p);
            const label = getPromotionLabel(p);
            const badgeClasses = getPromoTypeBadgeClasses(p.badge_color);

            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.04 }}
                className="flex items-center gap-4 rounded-lg border border-border bg-bg-surface px-4 py-3 transition-colors hover:border-gold/20"
              >
                {/* Deal badge */}
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${badgeClasses}`}>
                  {label}
                </span>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-text-primary">{p.title}</p>
                    <StatusPill status={status} />
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
                    {p.promo_code && (
                      <span className="font-mono uppercase text-gold/80">{p.promo_code}</span>
                    )}
                    {p.ends_at && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        Ends {new Date(p.ends_at).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                      </span>
                    )}
                    {p.max_uses && (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="size-3" />
                        {p.current_uses}/{p.max_uses} used
                      </span>
                    )}
                    <span className="capitalize">{p.applies_to.replace("_", "-")}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openEdit(p)}
                    className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-text-primary"
                    aria-label="Edit"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(p)}
                    className="flex size-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      <PromoFormDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setEditTarget(null); }}
        onSave={handleSave}
        saving={saving}
        initial={initialForm}
      />
    </AnimatedPage>
  );
}

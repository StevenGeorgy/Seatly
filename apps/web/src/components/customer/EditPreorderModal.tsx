import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Minus, Plus, Search, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StripePaymentForm } from "@/components/booking/StripePaymentForm";
import { SplitTenderPaymentForm } from "@/components/booking/SplitTenderPaymentForm";
import { SPLIT_TENDER_ENABLED } from "@/lib/featureFlags";
import {
  usePublicMenuCategories,
  usePublicMenuItems,
  type MenuItemRow,
} from "@/hooks/useMenuItems";
import { getProvincialTax } from "@/lib/billing/canadianTax";
import { toUserFacingEdgeError, toUserFacingError } from "@/lib/errors";
import { computeDinerCharge } from "@/lib/stripe-fee";
import {
  getSupabaseAnonKey,
  getSupabaseBrowserClient,
  getSupabaseProjectUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Pre-order edit modal. Used by both the logged-in BookingDetailsPage and
 * the guest ManageBookingView. Surfaces:
 *
 *   - Menu picker (reuses `usePublicMenuItems` / `usePublicMenuCategories`)
 *   - Cart edit (qty +/-, delete)
 *   - Optional promo code field
 *   - Live delta preview (food, tax, cenaiva fee, processing fee)
 *   - StripePaymentForm when the server reports `requires_payment: true`
 *
 * Auth handshake: callers either pass a bearer-token via the logged-in
 * Supabase session (handled internally) OR pass `{ confirmation_code, email }`
 * for the guest path. The `modify-reservation` edge fn accepts both.
 */

// ───────────────────────────────────────────────────────────────────────
// Types

/** Initial cart row pre-populated from the existing pre-order (if any). */
export type EditPreorderInitialItem = {
  menu_item_id: string;
  /** Display label from the order_items snapshot, kept as fallback if the
   * menu item is no longer in the live menu list. */
  name: string;
  /** Snapshot unit price for fallback display, in dollars. */
  unit_price: number;
  quantity: number;
};

type GuestAuth = {
  kind: "guest";
  confirmation_code: string;
  /** Email second factor — REQUIRED by modify-reservation since 2026-05-22. */
  email: string;
};

type LoggedInAuth = { kind: "logged_in" };

export type EditPreorderAuth = LoggedInAuth | GuestAuth;

type EditPreorderModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  restaurantId: string;
  /** Restaurant province (used for tax label + rate fallback). */
  restaurantProvince: string | null;
  /** Restaurant-level explicit tax_rate override; falls back to province. */
  restaurantTaxRate: number | null;
  /** Existing order items, if any. Empty array == "Add first pre-order". */
  initialItems: EditPreorderInitialItem[];
  /** Current applied promo code (read-only seed for the input). */
  initialPromoCode: string | null;
  auth: EditPreorderAuth;
  /**
   * Fired after the modify-reservation + (optional) confirm-modify-payment
   * round-trip succeeds. The parent should refresh reservation + payment
   * data so the new cart shows immediately.
   */
  onSaved: (summary: { requiredPayment: boolean; refundedCents?: number }) => void;
};

type CartLine = {
  menu_item_id: string;
  name: string;
  /** Live unit price in dollars from the menu, or fallback from snapshot. */
  unit_price: number;
  quantity: number;
  /** True when the menu item is no longer available — disables qty up. */
  unavailable: boolean;
};

// ───────────────────────────────────────────────────────────────────────
// Network helpers

type SplitPayer = {
  row_id: string;
  amount_cents: number;
  payer_full_name: string | null;
  payer_email: string | null;
};

type ModifyResponse =
  | {
      ok: true;
      requires_payment: false;
      refunded_cents?: number;
    }
  | {
      ok: false;
      requires_payment: true;
      // 2026-05-28 (PR-K): server returns either single deposit_payment_id
      // (legacy) or an array of N row IDs (split-tender).
      deposit_payment_row_ids: string[];
      is_split_tender: boolean;
      split_payers: SplitPayer[];
      food_cents: number;
      tax_cents: number;
      delta_cents?: number;
    };

type ModifyErrorBody = {
  ok?: boolean;
  error?: string;
  unavailable_reason?:
    | "cart_modify_too_late"
    | "mixed_modify_not_allowed"
    | "promo_invalid"
    | "menu_item_unavailable"
    | string;
};

async function callModifyReservation(
  reservationId: string,
  payload: {
    cart_items: Array<{ menu_item_id: string; quantity: number }>;
    applied_promo_code: string | null | undefined;
    tax_cents: number;
  },
  auth: EditPreorderAuth,
): Promise<
  | { kind: "ok"; data: ModifyResponse }
  | { kind: "err"; status: number; body: ModifyErrorBody; message: string }
> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }
  const client = getSupabaseBrowserClient();
  const headers: Record<string, string> = {
    apikey: getSupabaseAnonKey(),
    "Content-Type": "application/json",
  };
  if (auth.kind === "logged_in") {
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const body: Record<string, unknown> = {
    reservation_id: reservationId,
    cart_items: payload.cart_items,
    tax_cents: payload.tax_cents,
  };
  // Undefined = keep existing. null/"" = remove. String = set new.
  if (payload.applied_promo_code !== undefined) {
    body.applied_promo_code = payload.applied_promo_code;
  }
  if (auth.kind === "guest") {
    body.confirmation_code = auth.confirmation_code;
    body.email = auth.email;
  }
  const res = await fetch(`${getSupabaseProjectUrl()}/functions/v1/modify-reservation`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const raw = (await res.json().catch(() => ({}))) as ModifyErrorBody &
    Partial<{
      requires_payment: boolean;
      deposit_payment_id: string;
      deposit_payment_row_ids: string[];
      is_split_tender: boolean;
      split_payers: SplitPayer[];
      food_cents: number;
      tax_cents: number;
      refunded_cents: number;
      delta_cents: number;
    }>;
  const resolvedRowIds = raw.deposit_payment_row_ids
    ?? (typeof raw.deposit_payment_id === "string" ? [raw.deposit_payment_id] : null);
  if (
    res.ok &&
    raw.requires_payment === true &&
    resolvedRowIds &&
    resolvedRowIds.length > 0 &&
    typeof raw.food_cents === "number" &&
    typeof raw.tax_cents === "number"
  ) {
    return {
      kind: "ok",
      data: {
        ok: false,
        requires_payment: true,
        deposit_payment_row_ids: resolvedRowIds,
        is_split_tender: raw.is_split_tender === true || resolvedRowIds.length >= 2,
        split_payers: raw.split_payers ?? resolvedRowIds.map((id) => ({
          row_id: id,
          amount_cents: raw.delta_cents ?? 0,
          payer_full_name: null,
          payer_email: null,
        })),
        food_cents: raw.food_cents,
        tax_cents: raw.tax_cents,
        delta_cents: raw.delta_cents,
      },
    };
  }
  if (res.ok && (raw.requires_payment === false || raw.ok === true)) {
    return {
      kind: "ok",
      data: {
        ok: true,
        requires_payment: false,
        refunded_cents: typeof raw.refunded_cents === "number" ? raw.refunded_cents : undefined,
      },
    };
  }
  const friendly = toUserFacingEdgeError(res, raw as unknown as Record<string, unknown>);
  return { kind: "err", status: res.status, body: raw, message: friendly.message };
}

type ConfirmModifyResponse = {
  ok: boolean;
  error?: string;
};

async function callConfirmModifyPayment(
  reservationId: string,
  // 2026-05-28 (PR-K): arrays for split-tender; solo uses single-entry arrays.
  depositPaymentRowIds: string[],
  paymentIntentIds: string[],
  auth: EditPreorderAuth,
): Promise<{ kind: "ok" } | { kind: "err"; message: string }> {
  if (!isSupabaseConfigured()) {
    throw new Error("Authentication is not available. Configure Supabase first.");
  }
  const client = getSupabaseBrowserClient();
  const headers: Record<string, string> = {
    apikey: getSupabaseAnonKey(),
    "Content-Type": "application/json",
  };
  if (auth.kind === "logged_in") {
    const { data: sessionData } = await client.auth.getSession();
    const token = sessionData.session?.access_token ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const isMulti = depositPaymentRowIds.length > 1;
  const body: Record<string, unknown> = {
    reservation_id: reservationId,
    change_type: "cart_delta",
    ...(isMulti
      ? {
          deposit_payment_row_ids: depositPaymentRowIds,
          payment_intent_ids: paymentIntentIds,
        }
      : {
          deposit_payment_row_id: depositPaymentRowIds[0],
          payment_intent_id: paymentIntentIds[0],
        }),
  };
  if (auth.kind === "guest") {
    body.confirmation_code = auth.confirmation_code;
    body.email = auth.email;
  }
  const res = await fetch(
    `${getSupabaseProjectUrl()}/functions/v1/confirm-modify-payment`,
    { method: "POST", headers, body: JSON.stringify(body) },
  );
  const raw = (await res.json().catch(() => ({}))) as ConfirmModifyResponse;
  if (res.ok && raw.ok === true) return { kind: "ok" };
  const friendly = toUserFacingEdgeError(res, raw as unknown as Record<string, unknown>);
  return { kind: "err", message: friendly.message };
}

// ───────────────────────────────────────────────────────────────────────
// Component

export function EditPreorderModal(props: EditPreorderModalProps) {
  const {
    open,
    onOpenChange,
    reservationId,
    restaurantId,
    restaurantProvince,
    restaurantTaxRate,
    initialItems,
    initialPromoCode,
    auth,
    onSaved,
  } = props;

  // StripePaymentForm internally uses useUser to discover saved cards.
  // We don't need to read it here — caller decides logged-in vs guest via
  // the explicit `auth` prop.

  const { categories, loading: categoriesLoading } = usePublicMenuCategories(
    restaurantId,
    { enabled: open && Boolean(restaurantId) },
  );
  const { items: menuItems, loading: itemsLoading } = usePublicMenuItems(
    restaurantId,
    { enabled: open && Boolean(restaurantId) },
  );
  const menuLoading = categoriesLoading || itemsLoading;

  // ── Cart state ──
  const [cart, setCart] = useState<CartLine[]>([]);
  // promoMode === KEEP → don't send the field (undefined). Otherwise send
  // string (set) or null (remove).
  const [promoInput, setPromoInput] = useState<string>(initialPromoCode ?? "");
  const [promoMode, setPromoMode] = useState<"keep" | "edit">("keep");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Re-seed when the modal opens.
  useEffect(() => {
    if (!open) return;
    setCart(
      initialItems.map((i) => ({
        menu_item_id: i.menu_item_id,
        name: i.name,
        unit_price: i.unit_price,
        quantity: i.quantity,
        unavailable: false,
      })),
    );
    setPromoInput(initialPromoCode ?? "");
    setPromoMode("keep");
    setActiveCategoryId(null);
    setSearch("");
    setErrorMessage(null);
    setPendingPayment(null);
  }, [open, initialItems, initialPromoCode]);

  // When the live menu finishes loading, swap each cart line's name +
  // unit_price + availability flag to the canonical menu value. This
  // keeps the cart line in sync with current pricing and surfaces
  // "removed-from-menu" rows visually.
  useEffect(() => {
    if (!open || menuLoading) return;
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    setCart((prev) =>
      prev.map((line) => {
        const live = byId.get(line.menu_item_id);
        if (!live) {
          return { ...line, unavailable: true };
        }
        return {
          ...line,
          name: live.name,
          unit_price: Number(live.price) || line.unit_price,
          unavailable: false,
        };
      }),
    );
  }, [open, menuLoading, menuItems]);

  // ── Tax + delta math ──
  const taxRate = useMemo(() => {
    if (restaurantTaxRate != null) return restaurantTaxRate;
    return getProvincialTax(restaurantProvince).rate;
  }, [restaurantTaxRate, restaurantProvince]);
  const taxLabel = useMemo(
    () => getProvincialTax(restaurantProvince).label,
    [restaurantProvince],
  );

  const oldFoodCents = useMemo(
    () =>
      initialItems.reduce(
        (s, i) => s + Math.round(Number(i.unit_price) * 100) * i.quantity,
        0,
      ),
    [initialItems],
  );
  const newFoodCents = useMemo(
    () =>
      cart.reduce(
        (s, l) => s + Math.round(Number(l.unit_price) * 100) * l.quantity,
        0,
      ),
    [cart],
  );
  const newTaxCents = useMemo(
    () => Math.round(newFoodCents * taxRate),
    [newFoodCents, taxRate],
  );
  const oldTaxCents = useMemo(
    () => Math.round(oldFoodCents * taxRate),
    [oldFoodCents, taxRate],
  );
  // Delta math is display-only — server is source of truth on the actual
  // amount charged / refunded. Promo discounts aren't applied client-side
  // here because the server resolves promos against fresh rules.
  const deltaFoodCents = newFoodCents - oldFoodCents;
  const deltaTaxCents = newTaxCents - oldTaxCents;
  const grossDeltaCents = deltaFoodCents + deltaTaxCents;
  // Cenaiva + Stripe fee preview when the diner owes more.
  const dinerCharge = useMemo(() => {
    if (grossDeltaCents <= 0) {
      return computeDinerCharge(0, 0);
    }
    return computeDinerCharge(Math.max(0, deltaFoodCents), Math.max(0, deltaTaxCents));
  }, [grossDeltaCents, deltaFoodCents, deltaTaxCents]);

  // ── Mutation state ──
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingPayment, setPendingPayment] = useState<{
    // 2026-05-28 (PR-K): arrays for split-tender; solo is length 1.
    depositPaymentRowIds: string[];
    isSplitTender: boolean;
    splitPayers: SplitPayer[];
    foodCents: number;
    taxCents: number;
  } | null>(null);
  const [finalizingPayment, setFinalizingPayment] = useState(false);

  const hasChanges = useMemo(() => {
    if (cart.length !== initialItems.length) return true;
    const byInitial = new Map(initialItems.map((i) => [i.menu_item_id, i.quantity]));
    for (const line of cart) {
      const initial = byInitial.get(line.menu_item_id);
      if (initial === undefined || initial !== line.quantity) return true;
    }
    if (promoMode === "edit") {
      const newPromo = promoInput.trim();
      const initialPromo = (initialPromoCode ?? "").trim();
      if (newPromo !== initialPromo) return true;
    }
    return false;
  }, [cart, initialItems, promoMode, promoInput, initialPromoCode]);

  const handleSubmit = useCallback(async () => {
    if (submitting) return;
    if (cart.some((l) => l.unavailable && l.quantity > 0)) {
      setErrorMessage(
        "Some items in your cart are no longer on the menu. Remove them before continuing.",
      );
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const cartPayload = cart
        .filter((l) => l.quantity > 0)
        .map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity }));
      let appliedPromoCode: string | null | undefined = undefined;
      if (promoMode === "edit") {
        const trimmed = promoInput.trim();
        appliedPromoCode = trimmed.length > 0 ? trimmed : null;
      }
      const result = await callModifyReservation(
        reservationId,
        {
          cart_items: cartPayload,
          applied_promo_code: appliedPromoCode,
          tax_cents: newTaxCents,
        },
        auth,
      );
      if (result.kind === "err") {
        const reason = result.body.unavailable_reason;
        if (reason === "menu_item_unavailable") {
          setErrorMessage(
            "One of the items you picked just went unavailable. Refresh the menu and try again.",
          );
        } else if (reason === "cart_modify_too_late") {
          setErrorMessage(
            "Pre-order edits close 2 hours before your reservation.",
          );
        } else if (reason === "promo_invalid") {
          setErrorMessage("That promo code isn't valid for this booking.");
        } else if (reason === "mixed_modify_not_allowed") {
          setErrorMessage(
            "Cart changes and time changes must be submitted separately.",
          );
        } else {
          setErrorMessage(result.message);
        }
        setSubmitting(false);
        return;
      }
      if (result.data.requires_payment) {
        setPendingPayment({
          depositPaymentRowIds: result.data.deposit_payment_row_ids,
          isSplitTender: result.data.is_split_tender,
          splitPayers: result.data.split_payers,
          foodCents: result.data.food_cents,
          taxCents: result.data.tax_cents,
        });
        setSubmitting(false);
        return;
      }
      // No payment needed — done.
      setSubmitting(false);
      onSaved({
        requiredPayment: false,
        refundedCents: result.data.refunded_cents,
      });
      onOpenChange(false);
    } catch (err) {
      const friendly = toUserFacingError(err, "Couldn't update your pre-order. Try again.");
      setErrorMessage(friendly.message);
      console.error("[EditPreorderModal.submit]", friendly.code, friendly.technical ?? err);
      setSubmitting(false);
    }
  }, [
    submitting,
    cart,
    promoMode,
    promoInput,
    reservationId,
    auth,
    newTaxCents,
    onSaved,
    onOpenChange,
  ]);

  const handlePaymentPaid = useCallback(
    async (paymentIntentIds: string | string[]) => {
      if (!pendingPayment || finalizingPayment) return;
      const piIds = Array.isArray(paymentIntentIds) ? paymentIntentIds : [paymentIntentIds];
      if (piIds.length !== pendingPayment.depositPaymentRowIds.length) {
        setErrorMessage(
          `Payment count mismatch (got ${piIds.length}, expected ${pendingPayment.depositPaymentRowIds.length}).`,
        );
        return;
      }
      setFinalizingPayment(true);
      setErrorMessage(null);
      try {
        const result = await callConfirmModifyPayment(
          reservationId,
          pendingPayment.depositPaymentRowIds,
          piIds,
          auth,
        );
        if (result.kind === "err") {
          setErrorMessage(result.message);
          setFinalizingPayment(false);
          return;
        }
        setFinalizingPayment(false);
        setPendingPayment(null);
        onSaved({ requiredPayment: true });
        onOpenChange(false);
      } catch (err) {
        const friendly = toUserFacingError(
          err,
          "Couldn't finalize the pre-order change. Try again.",
        );
        setErrorMessage(friendly.message);
        console.error(
          "[EditPreorderModal.confirmPayment]",
          friendly.code,
          friendly.technical ?? err,
        );
        setFinalizingPayment(false);
      }
    },
    [pendingPayment, finalizingPayment, reservationId, auth, onSaved, onOpenChange],
  );

  // ── Filtered menu list for the picker ──
  const filteredMenu = useMemo<MenuItemRow[]>(() => {
    let list = menuItems;
    if (activeCategoryId) {
      list = list.filter((m) => m.category_id === activeCategoryId);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [menuItems, activeCategoryId, search]);

  // ── Cart mutators ──
  const incrementCart = (item: MenuItemRow) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.menu_item_id === item.id);
      if (existing) {
        return prev.map((l) =>
          l.menu_item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          menu_item_id: item.id,
          name: item.name,
          unit_price: Number(item.price) || 0,
          quantity: 1,
          unavailable: false,
        },
      ];
    });
  };
  const decrementCart = (menuItemId: string) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.menu_item_id === menuItemId ? { ...l, quantity: l.quantity - 1 } : l,
        )
        .filter((l) => l.quantity > 0),
    );
  };
  const removeFromCart = (menuItemId: string) => {
    setCart((prev) => prev.filter((l) => l.menu_item_id !== menuItemId));
  };

  // ── Render ──
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const sign = (cents: number) =>
    cents > 0 ? `+${dollars(cents)}` : cents < 0 ? `-${dollars(Math.abs(cents))}` : dollars(0);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't allow close mid-payment-finalize.
        if (!next && (submitting || finalizingPayment)) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {initialItems.length === 0 ? "Add a pre-order" : "Edit pre-order"}
          </DialogTitle>
        </DialogHeader>

        {pendingPayment ? (
          // ── Step 2: payment for delta ──
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-bg-surface/60 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary">Charge for changes</span>
                <span className="font-mono text-base font-semibold text-white">
                  {dollars(pendingPayment.foodCents + pendingPayment.taxCents)}
                </span>
              </div>
              <p className="mt-2 text-xs text-text-muted">
                {SPLIT_TENDER_ENABLED && pendingPayment.isSplitTender
                  ? `Split-tender — the upcharge is divided across ${pendingPayment.depositPaymentRowIds.length} cards proportional to each payer's original share. All cards must succeed.`
                  : "Pay the delta to confirm your updated pre-order. Cenaiva fee + Stripe processing apply on top."}
              </p>
              {SPLIT_TENDER_ENABLED && pendingPayment.isSplitTender ? (
                <ul className="mt-3 space-y-1 text-xs text-text-muted">
                  {pendingPayment.splitPayers.map((p, i) => (
                    <li key={p.row_id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        #{i + 1} ·{" "}
                        {(p.payer_full_name ?? "").trim() ||
                          (p.payer_email ?? "").trim() ||
                          `Co-payer ${i + 1}`}
                      </span>
                      <span className="font-mono tabular-nums">
                        ${(p.amount_cents / 100).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {SPLIT_TENDER_ENABLED && pendingPayment.isSplitTender ? (
              <>
                <SplitTenderPaymentForm
                  restaurantId={restaurantId}
                  foodTotalCents={pendingPayment.foodCents}
                  taxTotalCents={pendingPayment.taxCents}
                  payerCount={pendingPayment.depositPaymentRowIds.length}
                  holdId={null}
                  formId="edit-preorder-split-pay-form"
                  onPreCheckout={async () => ({
                    reservation_id: reservationId,
                    deposit_row_ids: pendingPayment.depositPaymentRowIds,
                  })}
                  onAllPaid={async ({ paymentIntentIds }) => {
                    await handlePaymentPaid(paymentIntentIds);
                  }}
                  onError={(msg) => setErrorMessage(msg)}
                />
                <Button
                  type="submit"
                  form="edit-preorder-split-pay-form"
                  disabled={finalizingPayment}
                  className="h-10 w-full"
                >
                  {finalizingPayment ? "Finalizing…" : "Pay & confirm pre-order"}
                </Button>
              </>
            ) : (
              <StripePaymentForm
                restaurantId={restaurantId}
                amountCents={pendingPayment.foodCents}
                taxCents={pendingPayment.taxCents}
                depositPaymentIds={pendingPayment.depositPaymentRowIds}
                onPaid={handlePaymentPaid}
                payButtonLabel={finalizingPayment ? "Finalizing…" : "Pay & confirm pre-order"}
              />
            )}
            {errorMessage ? (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                {errorMessage}
              </div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (finalizingPayment) return;
                setPendingPayment(null);
              }}
              disabled={finalizingPayment}
              className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
            >
              Back to cart
            </Button>
          </div>
        ) : (
          // ── Step 1: cart edit ──
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            {/* Menu picker */}
            <section>
              <div className="mb-3 flex items-center gap-2">
                <Search className="size-4 text-text-muted" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search menu items"
                  className="h-9"
                />
              </div>
              {categories.length > 1 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveCategoryId(null)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      activeCategoryId === null
                        ? "border-gold/60 bg-gold/10 text-gold"
                        : "border-border bg-bg-surface/60 text-text-secondary hover:border-border-strong",
                    )}
                  >
                    All
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setActiveCategoryId(c.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                        activeCategoryId === c.id
                          ? "border-gold/60 bg-gold/10 text-gold"
                          : "border-border bg-bg-surface/60 text-text-secondary hover:border-border-strong",
                      )}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="max-h-[44vh] space-y-2 overflow-y-auto pr-1">
                {menuLoading && (
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-bg-surface/40 p-4 text-sm text-text-muted">
                    <Loader2 className="size-4 animate-spin" /> Loading menu…
                  </div>
                )}
                {!menuLoading && filteredMenu.length === 0 && (
                  <p className="rounded-xl border border-border bg-bg-surface/40 p-4 text-sm text-text-muted">
                    No menu items match your search.
                  </p>
                )}
                {filteredMenu.map((item) => {
                  const inCart = cart.find((l) => l.menu_item_id === item.id);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-xl border border-border bg-bg-surface/60 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{item.name}</p>
                        <p className="font-mono text-xs text-text-muted">
                          ${Number(item.price).toFixed(2)}
                        </p>
                      </div>
                      {inCart ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => decrementCart(item.id)}
                            className="flex size-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-bg-elevated"
                            aria-label={`Remove one ${item.name}`}
                          >
                            <Minus className="size-3.5" />
                          </button>
                          <span className="min-w-[1.5rem] text-center text-sm font-semibold text-white">
                            {inCart.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => incrementCart(item)}
                            className="flex size-7 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-bg-elevated"
                            aria-label={`Add one ${item.name}`}
                          >
                            <Plus className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => incrementCart(item)}
                          className="h-8 gap-1"
                        >
                          <Plus className="size-3.5" />
                          Add
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Cart + promo + delta preview */}
            <aside className="space-y-4">
              <div className="rounded-2xl border border-border bg-bg-base/40 p-4">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Your pre-order
                </h3>
                {cart.length === 0 ? (
                  <p className="mt-3 text-sm text-text-muted">No items yet — add from the menu.</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {cart.map((line) => (
                      <li
                        key={line.menu_item_id}
                        className={cn(
                          "flex items-center gap-2 text-sm",
                          line.unavailable && "opacity-60",
                        )}
                      >
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => decrementCart(line.menu_item_id)}
                            className="flex size-6 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-bg-elevated"
                            aria-label={`Decrease ${line.name}`}
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="min-w-[1.25rem] text-center text-sm font-semibold text-white">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              incrementCart({
                                id: line.menu_item_id,
                                name: line.name,
                                price: line.unit_price,
                              } as unknown as MenuItemRow)
                            }
                            disabled={line.unavailable}
                            className="flex size-6 items-center justify-center rounded-md border border-border text-text-secondary hover:bg-bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`Increase ${line.name}`}
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                        <span className="flex-1 truncate text-text-secondary">
                          {line.name}
                          {line.unavailable && (
                            <span className="ml-1 text-warning">(removed)</span>
                          )}
                        </span>
                        <span className="font-mono text-xs text-text-muted">
                          ${(line.unit_price * line.quantity).toFixed(2)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFromCart(line.menu_item_id)}
                          className="text-text-muted hover:text-danger"
                          aria-label={`Remove ${line.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Promo code */}
              <div className="rounded-2xl border border-border bg-bg-base/40 p-4">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Promo code
                </h3>
                {promoMode === "keep" ? (
                  <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                    <span className="text-text-secondary">
                      {initialPromoCode ? (
                        <>
                          Current: <span className="font-mono text-white">{initialPromoCode}</span>
                        </>
                      ) : (
                        <span className="text-text-muted">None applied</span>
                      )}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPromoMode("edit")}
                    >
                      Change
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <Input
                        value={promoInput}
                        onChange={(e) => setPromoInput(e.target.value)}
                        placeholder="Enter code"
                        className="h-9 font-mono"
                      />
                      {promoInput ? (
                        <button
                          type="button"
                          onClick={() => setPromoInput("")}
                          className="text-text-muted hover:text-text-primary"
                          aria-label="Clear promo code"
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setPromoMode("keep");
                          setPromoInput(initialPromoCode ?? "");
                        }}
                        className="text-text-muted hover:text-text-primary"
                      >
                        Keep current
                      </button>
                      <span className="text-text-muted">
                        Leave blank to remove an existing code.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Delta preview */}
              <div className="rounded-2xl border border-border bg-bg-surface/60 p-4">
                <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  Pre-order changes
                </h3>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">Food</dt>
                    <dd className="font-mono text-white">{sign(deltaFoodCents)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-text-secondary">{taxLabel}</dt>
                    <dd className="font-mono text-white">{sign(deltaTaxCents)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5">
                    <dt className="text-text-secondary">Net change</dt>
                    <dd
                      className={cn(
                        "font-mono font-semibold",
                        grossDeltaCents > 0
                          ? "text-white"
                          : grossDeltaCents < 0
                            ? "text-success"
                            : "text-text-muted",
                      )}
                    >
                      {sign(grossDeltaCents)}
                    </dd>
                  </div>
                  {grossDeltaCents > 0 && (
                    <>
                      <div className="flex justify-between pt-1 text-xs">
                        <dt className="text-text-muted">Cenaiva fee (2%)</dt>
                        <dd className="font-mono text-text-muted">
                          +{dollars(dinerCharge.cenaivaFeeCents)}
                        </dd>
                      </div>
                      <div className="flex justify-between text-xs">
                        <dt className="text-text-muted">Stripe processing</dt>
                        <dd className="font-mono text-text-muted">
                          +{dollars(dinerCharge.processingFeeCents)}
                        </dd>
                      </div>
                      <div className="flex justify-between border-t border-border pt-1.5 text-base">
                        <dt className="text-white">Total charge</dt>
                        <dd className="font-mono font-semibold text-white">
                          {dollars(dinerCharge.dinerTotalCents)}
                        </dd>
                      </div>
                    </>
                  )}
                  {grossDeltaCents < 0 && (
                    <p className="pt-1 text-xs text-text-muted">
                      Refund issued to your original card. Final refund may differ
                      slightly — non-refundable Cenaiva + Stripe fees on the
                      original charge are kept per policy.
                    </p>
                  )}
                </dl>
              </div>

              {errorMessage ? (
                <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
                  {errorMessage}
                </div>
              ) : null}

              <div className="space-y-2">
                <Button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={submitting || !hasChanges}
                  className="h-12 w-full rounded-xl text-sm font-semibold"
                >
                  {submitting
                    ? "Saving…"
                    : !hasChanges
                      ? "No changes yet"
                      : grossDeltaCents > 0
                        ? "Confirm pre-order changes & pay"
                        : grossDeltaCents < 0
                          ? "Confirm & refund difference"
                          : "Confirm pre-order changes"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="h-9 w-full text-sm font-normal text-text-muted hover:text-text-primary"
                >
                  Discard changes
                </Button>
              </div>
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

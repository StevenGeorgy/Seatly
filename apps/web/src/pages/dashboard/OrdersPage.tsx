import { useEffect, useMemo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { UtensilsCrossed, Wine, Plus, Minus, X, Phone, User, Search, AlertTriangle, MessageSquare } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNowStrict } from "date-fns";

import { AnimatedPage } from "@/components/dashboard/AnimatedPage";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrders, type OrderRow } from "@/hooks/useOrders";
import { useMenuItems, type MenuItemRow } from "@/hooks/useMenuItems";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";

// ─── Types ────────────────────────────────────────────────────────────────────
type KdsColumn = { key: string; label: string; items: OrderRow[] };
type NewOrderType = "dine_in" | "takeout" | "delivery";
type CartLine = { item: MenuItemRow; qty: number };

// ─── New Order Drawer ─────────────────────────────────────────────────────────
function NewOrderDrawer({
  open,
  onClose,
  onSaved,
  restaurantId,
  currency,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  restaurantId: string | null;
  currency: string;
}) {
  const [orderType, setOrderType] = useState<NewOrderType>("dine_in");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { items: menuItems, loading: menuLoading } = useMenuItems();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const realItems = useMemo(
    () => menuItems.filter((m) => UUID_RE.test(m.id) && m.is_active),
    [menuItems],
  );

  const filteredItems = useMemo(() => {
    if (!search.trim()) return realItems;
    const q = search.toLowerCase();
    return realItems.filter((m) => m.name.toLowerCase().includes(q));
  }, [realItems, search]);

  const addToCart = (item: MenuItemRow) => {
    setCart((c) => {
      const existing = c.find((l) => l.item.id === item.id);
      if (existing) return c.map((l) => l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l);
      return [...c, { item, qty: 1 }];
    });
  };

  const updateQty = (itemId: string, delta: number) => {
    setCart((c) =>
      c
        .map((l) => l.item.id === itemId ? { ...l, qty: l.qty + delta } : l)
        .filter((l) => l.qty > 0),
    );
  };

  const subtotal = cart.reduce((sum, l) => sum + l.item.price * l.qty, 0);

  const reset = () => {
    setOrderType("dine_in");
    setCustomerName("");
    setCustomerPhone("");
    setNotes("");
    setCart([]);
    setSearch("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = useCallback(async () => {
    if (!restaurantId || !isSupabaseConfigured() || cart.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      const client = getSupabaseBrowserClient();
      const code = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      const { data: orderData, error: orderErr } = await client
        .from("orders")
        .insert({
          restaurant_id: restaurantId,
          is_preorder: false,
          order_type: orderType,
          status: "pending",
          subtotal: Math.round(subtotal * 100) / 100,
          confirmation_code: code,
        })
        .select("id")
        .single();
      if (orderErr) throw new Error(orderErr.message);

      const items = cart.map((l) => ({
        order_id: orderData.id,
        menu_item_id: l.item.id,
        name: l.item.name,
        quantity: l.qty,
        unit_price: Math.round(l.item.price * 100) / 100,
        line_total: Math.round(l.item.price * l.qty * 100) / 100,
        modifications: notes || null,
        status: "pending",
      }));
      const { error: itemsErr } = await client.from("order_items").insert(items);
      if (itemsErr) throw new Error(itemsErr.message);

      reset();
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create order");
    } finally {
      setSaving(false);
    }
  }, [restaurantId, cart, orderType, subtotal, notes, onSaved, onClose]);

  const orderTypes: { key: NewOrderType; label: string }[] = [
    { key: "dine_in", label: "Dine In" },
    { key: "takeout", label: "Pickup" },
    { key: "delivery", label: "Delivery" },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={handleClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-bg-surface shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-text-primary">New Order</h2>
              <button
                type="button"
                onClick={handleClose}
                className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:text-text-primary transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            {/* Form */}
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
              {/* Order Type */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Order Type</Label>
                <div className="flex gap-2">
                  {orderTypes.map((ot) => (
                    <button
                      key={ot.key}
                      type="button"
                      onClick={() => setOrderType(ot.key)}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                        orderType === ot.key
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-border text-text-secondary hover:border-gold/30"
                      }`}
                    >
                      {ot.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Customer Info */}
              <div className="flex flex-col gap-3">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Customer Info (optional)</Label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <Input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Customer name"
                    className="pl-9"
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <Input
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Phone number"
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Menu Items */}
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Menu Items</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search menu..."
                    className="pl-9"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-border">
                  {menuLoading ? (
                    <div className="p-3 text-xs text-text-muted">Loading menu...</div>
                  ) : filteredItems.length === 0 ? (
                    <div className="p-3 text-xs text-text-muted">No items found</div>
                  ) : (
                    filteredItems.map((item) => {
                      const inCart = cart.find((l) => l.item.id === item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => addToCart(item)}
                          className="flex w-full items-center justify-between border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0 hover:bg-bg-elevated/50"
                        >
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-text-primary">{item.name}</span>
                            <span className="text-xs text-text-muted">{formatCurrency(item.price, currency)}</span>
                          </div>
                          {inCart ? (
                            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-gold/20 text-xs font-bold text-gold">
                              {inCart.qty}
                            </span>
                          ) : (
                            <Plus className="size-4 shrink-0 text-text-muted" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Cart */}
              {cart.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Order Summary</Label>
                  <div className="rounded-lg border border-border bg-bg-elevated">
                    {cart.map((line) => (
                      <div key={line.item.id} className="flex items-center justify-between border-b border-border px-3 py-2 last:border-b-0">
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-sm text-text-primary">{line.item.name}</span>
                          <span className="text-xs text-text-muted">{formatCurrency(line.item.price * line.qty, currency)}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => updateQty(line.item.id, -1)}
                            className="flex size-6 items-center justify-center rounded border border-border text-text-muted hover:text-text-primary transition-colors"
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="w-5 text-center text-sm font-semibold text-text-primary">{line.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(line.item.id, 1)}
                            className="flex size-6 items-center justify-center rounded border border-border text-text-muted hover:text-text-primary transition-colors"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-3 py-2 text-sm font-semibold text-text-primary">
                      <span>Subtotal</span>
                      <span>{formatCurrency(subtotal, currency)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Notes (optional)</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special instructions..."
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
              {error && <p className="text-xs text-danger">{error}</p>}
              <Button
                className="w-full"
                disabled={cart.length === 0 || saving}
                onClick={() => void handleSubmit()}
              >
                {saving ? "Placing order..." : `Place Order · ${formatCurrency(subtotal, currency)}`}
              </Button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OrdersPage() {
  const { t } = useTranslation();
  const [barOnly, setBarOnly] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { selectedRestaurantId, selectedRestaurant } = useRestaurantScope();

  // Clear bar filter when switching to a restaurant that has no bar
  useEffect(() => {
    if (!selectedRestaurant?.has_bar) setBarOnly(false);
  }, [selectedRestaurant?.id, selectedRestaurant?.has_bar]);

  const { orders, loading, refetch } = useOrders({ barOnly });
  const currency = selectedRestaurant?.currency ?? "CAD";

  const columns = useMemo((): KdsColumn[] => {
    const pending = orders.filter((o) => o.status === "pending" || o.status === "confirmed");
    const inProgress = orders.filter((o) => o.status === "preparing");
    const ready = orders.filter((o) => o.status === "ready");
    return [
      { key: "pending", label: t("dashboard.orders.pending"), items: pending },
      { key: "inProgress", label: t("dashboard.orders.inProgress"), items: inProgress },
      { key: "ready", label: t("dashboard.orders.readyToServe"), items: ready },
    ];
  }, [orders, t]);

  const advanceOrder = async (orderId: string, currentStatus: string) => {
    if (!isSupabaseConfigured()) return;
    const next: Record<string, string> = {
      pending: "preparing",
      confirmed: "preparing",
      preparing: "ready",
      ready: "served",
    };
    const newStatus = next[currentStatus];
    if (!newStatus) return;
    const client = getSupabaseBrowserClient();
    await client.from("orders").update({ status: newStatus }).eq("id", orderId);
    void refetch();
  };

  const columnColors: Record<string, string> = {
    pending: "border-warning/30",
    inProgress: "border-info/30",
    ready: "border-success/30",
  };

  return (
    <AnimatedPage className="flex flex-col gap-6">
      <PageHeader
        title={t("dashboard.orders.title")}
        actions={
          <div className="flex items-center gap-2">
            <Button
              size="default"
              className="gap-2"
              onClick={() => setDrawerOpen(true)}
            >
              <Plus className="size-4" />
              New Order
            </Button>
            {selectedRestaurant?.has_bar && (
              <Button
                variant={barOnly ? "default" : "outline"}
                size="default"
                className="gap-2"
                onClick={() => setBarOnly(!barOnly)}
              >
                <Wine className="size-4" />
                {barOnly ? t("dashboard.orders.allItems") : t("dashboard.orders.barOnly")}
              </Button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[400px] rounded-lg" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed className="size-5" />}
          title={t("dashboard.orders.noOrders")}
          description={t("dashboard.orders.noOrdersDesc")}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map((col) => (
            <div key={col.key} className={`flex flex-col rounded-xl border-2 ${columnColors[col.key] ?? "border-border"} bg-bg-surface`}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-text-primary">{col.label}</h3>
                <span className="flex size-6 items-center justify-center rounded-full bg-bg-elevated text-xs font-semibold text-text-secondary">
                  {col.items.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-3">
                <AnimatePresence mode="popLayout">
                  {col.items.map((order) => {
                    const tableNum = order.reservations?.tables?.table_number ?? "\u2014";
                    const timeAgo = order.created_at
                      ? formatDistanceToNowStrict(new Date(order.created_at), { addSuffix: false })
                      : "";

                    return (
                      <motion.div
                        key={order.id}
                        layout
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                        className="group rounded-lg border border-border bg-bg-elevated p-3 transition-colors hover:border-gold/30"
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wider text-gold">
                              {order.order_type === "pickup" || order.order_type === "takeout"
                                ? "Pickup"
                                : order.order_type === "delivery"
                                  ? "Delivery"
                                  : `${t("dashboard.orders.table")} ${tableNum}`}
                            </span>
                            {order.source === "cenaiva" && (
                              <span className="rounded bg-[#C8A951]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#C8A951]">
                                AI
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-text-muted">{timeAgo}</span>
                        </div>

                        {/* Guest name */}
                        {order.guests?.full_name && (
                          <p className="mb-1.5 text-xs font-medium text-text-secondary">
                            {order.guests.full_name}
                          </p>
                        )}

                        {/* Allergies / dietary — shown prominently */}
                        {((order.guests?.allergies?.length ?? 0) > 0 || (order.guests?.dietary_restrictions?.length ?? 0) > 0) && (
                          <div className="mb-2 flex items-start gap-1.5 rounded bg-warning/10 px-2 py-1.5">
                            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warning" />
                            <p className="text-xs text-warning">
                              {[
                                ...(order.guests?.allergies ?? []).map((a) => `⚠ ${a}`),
                                ...(order.guests?.dietary_restrictions ?? []),
                              ].join(" · ")}
                            </p>
                          </div>
                        )}

                        {/* Order notes / special requests */}
                        {order.notes && (
                          <div className="mb-2 flex items-start gap-1.5 rounded bg-bg-surface px-2 py-1.5">
                            <MessageSquare className="mt-0.5 size-3 shrink-0 text-text-muted" />
                            <p className="text-xs text-text-muted">{order.notes}</p>
                          </div>
                        )}

                        <ul className="mb-3 flex flex-col gap-1">
                          {order.order_items.slice(0, 5).map((item) => (
                            <li key={item.id} className="flex items-start gap-2 text-sm text-text-secondary">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded bg-bg-surface text-xs font-semibold text-text-muted">
                                {item.quantity}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate">{item.name || item.menu_items?.name || "\u2014"}</span>
                                {item.modifications && (
                                  <span className="block truncate text-xs text-text-muted">{item.modifications}</span>
                                )}
                              </span>
                            </li>
                          ))}
                          {order.order_items.length > 5 ? (
                            <li className="text-xs text-text-muted">
                              +{order.order_items.length - 5} more
                            </li>
                          ) : null}
                        </ul>
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => void advanceOrder(order.id, order.status)}
                        >
                          {order.status === "pending" || order.status === "confirmed"
                            ? t("dashboard.orders.startPreparing")
                            : order.status === "preparing"
                              ? t("dashboard.orders.markReady")
                              : t("dashboard.orders.markServed")}
                        </Button>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                {col.items.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center py-12 text-xs text-text-muted">
                    {t("common.empty.noData")}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}

      <NewOrderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => void refetch()}
        restaurantId={selectedRestaurantId}
        currency={currency}
      />
    </AnimatedPage>
  );
}

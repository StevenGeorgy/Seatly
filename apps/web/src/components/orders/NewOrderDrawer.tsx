import { useCallback, useMemo, useState } from "react";
import { Plus, Minus, X, Phone, User, Search } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMenuItems, type MenuItemRow } from "@/hooks/useMenuItems";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils/formatCurrency";

type CartLine = { item: MenuItemRow; qty: number };

type NewOrderDrawerProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  restaurantId: string | null;
  currency: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function NewOrderDrawer({ open, onClose, onSaved, restaurantId, currency }: NewOrderDrawerProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { items: menuItems, loading: menuLoading } = useMenuItems();

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
      if (existing) return c.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { item, qty: 1 }];
    });
  };

  const updateQty = (itemId: string, delta: number) => {
    setCart((c) =>
      c
        .map((l) => (l.item.id === itemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  };

  const subtotal = cart.reduce((sum, l) => sum + l.item.price * l.qty, 0);

  const reset = () => {
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
          order_type: "dine_in",
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
  }, [restaurantId, cart, subtotal, notes, onSaved, onClose]);

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
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-text-primary">New ticket</h2>
              <button
                type="button"
                onClick={handleClose}
                className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:text-text-primary"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
              <div className="flex flex-col gap-3">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Customer info (optional)
                </Label>
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

              <div className="flex flex-col gap-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Menu items
                </Label>
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

              {cart.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                    Order summary
                  </Label>
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
                            className="flex size-6 items-center justify-center rounded border border-border text-text-muted transition-colors hover:text-text-primary"
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="w-5 text-center text-sm font-semibold text-text-primary">{line.qty}</span>
                          <button
                            type="button"
                            onClick={() => updateQty(line.item.id, 1)}
                            className="flex size-6 items-center justify-center rounded border border-border text-text-muted transition-colors hover:text-text-primary"
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

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Notes (optional)
                </Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Special instructions..."
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
              {error && <p className="text-xs text-danger">{error}</p>}
              <Button
                className="w-full"
                disabled={cart.length === 0 || saving}
                onClick={() => void handleSubmit()}
              >
                {saving ? "Placing order..." : `Place order · ${formatCurrency(subtotal, currency)}`}
              </Button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

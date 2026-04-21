import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Clock, Users, CheckCircle2, Plus, Minus, ShoppingCart } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useAvailability } from "@/hooks/useAvailability";
import { usePublicMenuItems, usePublicMenuCategories } from "@/hooks/useMenuItems";
import { usePublicRestaurants } from "@/hooks/useRestaurant";
import { ExitButton } from "@/components/cenaiva/ExitButton";

interface BookingSheetProps {
  onExit: () => void;
}

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

export function BookingSheet({ onExit }: BookingSheetProps) {
  const { state, dispatch } = useAssistantStore();
  const assistant = useAssistant();
  const availability = useAvailability();
  const { restaurants } = usePublicRestaurants();
  const { booking, showExitX } = state;

  // Only fetch menu data once the booking actually reaches a menu-relevant
  // stage. Fetching + grouping a full restaurant menu while the user is still
  // at "collecting_minimum_fields" is pure render waste — and combined with
  // the AnimatePresence/ctx churn it was enough to trigger "Page Unresponsive".
  const needsMenu =
    booking.status === "offering_preorder" ||
    booking.status === "browsing_menu" ||
    booking.status === "post_booking" ||
    booking.status === "collecting_payment" ||
    booking.status === "paid";
  const menuRestaurantId = needsMenu ? booking.restaurant_id : null;
  const { items: menuItems } = usePublicMenuItems(menuRestaurantId);
  const { categories } = usePublicMenuCategories(menuRestaurantId);

  const [specialRequest, setSpecialRequest] = useState("");
  const [occasion, setOccasion] = useState("");
  const [customTipInput, setCustomTipInput] = useState("");
  const [showCustomTip, setShowCustomTip] = useState(false);

  // `offering_preorder` keeps the confirmation card visible while the preorder
  // Yes/No buttons are shown underneath — see the offer_preorder branch below.
  const isConfirmed =
    booking.status === "confirmed" ||
    booking.status === "offering_preorder" ||
    booking.status === "post_booking";
  const isPostBooking = booking.status === "post_booking";
  const isPaid = booking.status === "paid";

  const handleLoadAvailability = () => {
    if (!booking.restaurant_id || !booking.date || !booking.party_size) return;
    dispatch({ type: "load_availability" });
    void availability.fetchSlots(booking.restaurant_id, booking.date, booking.party_size);
  };

  const handleSlotSelect = (slot: { shift_id: string; date_time: string; display_time: string }) => {
    dispatch({ type: "select_time_slot", slot_iso: slot.date_time, shift_id: slot.shift_id });
    void assistant?.sendTranscript(`I'll take the ${slot.display_time} slot`);
  };

  const handleConfirm = () => {
    void assistant?.sendTranscript("Yes, confirm my booking");
  };

  const handlePostBookingSave = () => {
    const parts: string[] = [];
    if (specialRequest.trim()) parts.push(`special request: ${specialRequest}`);
    if (occasion.trim()) parts.push(`occasion: ${occasion}`);
    if (parts.length) {
      // Fire-and-forget: orchestrator patches post-booking in the background
      // while we close the shell immediately.
      void assistant?.sendTranscript(parts.join(", "));
    }
    onExit();
  };

  // ── Menu item helpers ────────────────────────────────────────────────────────

  const cartMap = useMemo(
    () => new Map(booking.cart.map((c) => [c.menu_item_id, c.qty])),
    [booking.cart],
  );

  const addItem = (item: { id: string; name: string; price: number }) => {
    dispatch({ type: "add_menu_item", menu_item_id: item.id, name: item.name, unit_price: item.price });
  };

  const removeItem = (menuItemId: string) => {
    const existing = booking.cart.find((c) => c.menu_item_id === menuItemId);
    if (!existing) return;
    if (existing.qty <= 1) {
      dispatch({ type: "remove_menu_item", menu_item_id: menuItemId });
    } else {
      // Decrement by dispatching add with negative is tricky — remove then re-add
      dispatch({ type: "remove_menu_item", menu_item_id: menuItemId });
      dispatch({
        type: "add_menu_item",
        menu_item_id: existing.menu_item_id,
        name: existing.name,
        unit_price: existing.unit_price,
        qty: existing.qty - 1,
      });
    }
  };

  // ── Tip helpers ──────────────────────────────────────────────────────────────

  const applyTipPercent = (percent: number) => {
    dispatch({ type: "set_tip", percent });
    void assistant?.sendTranscript(`${percent} percent tip`);
  };

  const applyCustomTip = () => {
    const val = parseFloat(customTipInput.replace(/[^0-9.]/g, ""));
    if (!val || val < 0) return;
    // If > 100 treat as dollar amount, else as percent
    if (val > 100) {
      dispatch({ type: "set_tip", amount: val });
      void assistant?.sendTranscript(`${val} dollar tip`);
    } else {
      dispatch({ type: "set_tip", percent: val });
      void assistant?.sendTranscript(`${val} percent tip`);
    }
  };

  // Preorderable items grouped by category — memoized because every render
  // would otherwise re-filter + re-reduce the entire menu list. Computed
  // BEFORE the early-return so hook order stays stable across renders.
  const grouped = useMemo<Record<string, typeof menuItems>>(() => {
    if (!menuItems.length) return {};
    const preorderable = menuItems.filter((i) => i.is_preorderable && i.is_available);
    const catMap = new Map(categories.map((c) => [c.id, c.name]));
    return preorderable.reduce<Record<string, typeof menuItems>>((acc, item) => {
      const key = item.category_id
        ? (catMap.get(item.category_id) ?? item.category ?? "Other")
        : (item.category ?? "Other");
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }, [menuItems, categories]);

  // ── Guard: nothing to show until booking is started ──────────────────────────
  // "collecting_minimum_fields" is a valid rendered state — the branch at the
  // bottom of this component shows the party-size/date chips for that status.

  if (booking.status === "idle") return null;

  // Computed tip for display
  const tipDisplay = booking.tip_percent != null
    ? `${booking.tip_percent}%`
    : booking.tip_amount != null
    ? formatCurrency(booking.tip_amount)
    : null;

  const tipDollars = booking.tip_percent != null
    ? Math.round(booking.cart_subtotal * (booking.tip_percent / 100) * 100) / 100
    : (booking.tip_amount ?? 0);

  const totalWithTip = Math.round((booking.cart_subtotal + tipDollars) * 100) / 100;

  return (
    <AnimatePresence>
      <motion.div
        key="booking-sheet"
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 280 }}
        className="absolute bottom-0 left-0 right-0 z-40 bg-[#111] border-t border-white/10 rounded-t-2xl overflow-hidden"
      >
        {showExitX && <ExitButton onExit={onExit} />}

        <div className="p-4 max-h-[65vh] overflow-y-auto">

          {/* ── Confirmation screen ──────────────────────────────────────────── */}
          {(isConfirmed || isPaid) && booking.confirmation_code && (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-[#C8A951] mx-auto mb-3" />
              <h2 className="text-white text-lg font-semibold">
                {isPaid ? "You're all set!" : "You're booked!"}
              </h2>
              <p className="text-white/60 text-sm mt-1">
                Reservation: <span className="text-[#C8A951] font-mono">{booking.confirmation_code}</span>
              </p>
              {booking.restaurant_name && (
                <p className="text-white/50 text-sm mt-1">{booking.restaurant_name}</p>
              )}
              <div className="flex items-center justify-center gap-4 mt-3 text-white/60 text-sm">
                {booking.party_size && (
                  <span className="flex items-center gap-1">
                    <Users className="w-4 h-4" />{booking.party_size}
                  </span>
                )}
                {booking.date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {(() => {
                      try { return format(new Date(booking.date), "MMM d"); } catch { return booking.date; }
                    })()}
                  </span>
                )}
                {booking.time && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />{booking.time}
                  </span>
                )}
              </div>
              {isPaid && booking.cart_subtotal > 0 && (
                <p className="text-[#C8A951] text-sm mt-3 font-medium">
                  Paid {formatCurrency(totalWithTip)} · See you then!
                </p>
              )}
            </div>
          )}

          {/* ── Post-booking extras ──────────────────────────────────────────── */}
          {isPostBooking && (
            <div className="mt-4 space-y-3">
              <p className="text-white/70 text-sm text-center">Anything to add? (optional)</p>

              <div>
                <label className="text-white/50 text-xs uppercase tracking-wide">Special request</label>
                <input
                  value={specialRequest}
                  onChange={(e) => setSpecialRequest(e.target.value)}
                  placeholder="Allergies, accessibility needs..."
                  className="mt-1 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#C8A951]"
                />
              </div>

              <div>
                <label className="text-white/50 text-xs uppercase tracking-wide">Occasion</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {["Birthday", "Anniversary", "Date Night", "Business Dinner", "Family"].map((occ) => (
                    <button
                      key={occ}
                      onClick={() => setOccasion(occ === occasion ? "" : occ)}
                      className={cn(
                        "px-3 py-1 rounded-full text-sm border transition-colors",
                        occasion === occ
                          ? "bg-[#C8A951] text-black border-[#C8A951]"
                          : "border-white/20 text-white/60 hover:border-white/40",
                      )}
                    >
                      {occ}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1 border-white/20 text-white/60 hover:bg-white/5"
                  onClick={onExit}
                >
                  Skip
                </Button>
                <Button
                  className="flex-1 bg-[#C8A951] text-black hover:bg-[#E6C060]"
                  onClick={handlePostBookingSave}
                >
                  Save & close
                </Button>
              </div>
            </div>
          )}

          {/* ── Offer pre-order ──────────────────────────────────────────────── */}
          {booking.status === "offering_preorder" && (
            <div className="py-4 text-center space-y-4">
              <ShoppingCart className="w-10 h-10 text-[#C8A951] mx-auto" />
              <p className="text-white text-sm">Would you like to pre-order from the menu?</p>
              <p className="text-white/40 text-xs">Pay before you arrive — skip the wait.</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => {
                    // "Yes" hands the user off to the restaurant's public page so
                    // they can browse and add items manually. We close the
                    // assistant so TTS / mic don't keep running in the
                    // background while they shop.
                    const slug = restaurants.find(
                      (r) => r.id === booking.restaurant_id,
                    )?.slug;
                    const menuPath = slug ? `/${slug}?step=menu` : undefined;
                    void assistant?.sayGoodbyeAndClose(
                      "Opening the menu now. Enjoy!",
                      menuPath,
                    );
                  }}
                  className="px-6 py-2.5 rounded-full bg-[#C8A951] text-black text-sm font-medium hover:bg-[#E6C060] transition-colors"
                >
                  Yes, pre-order
                </button>
                <button
                  onClick={() => {
                    // "No" ends the flow right here — no orchestrator round-trip.
                    // Cenaiva says bye, the shell closes, and we land on /discover.
                    void assistant?.sayGoodbyeAndClose("You're all set. Enjoy your meal. Bye!");
                  }}
                  className="px-6 py-2.5 rounded-full border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                >
                  No thanks
                </button>
              </div>
            </div>
          )}

          {/* ── Browse menu ──────────────────────────────────────────────────── */}
          {booking.status === "browsing_menu" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-white text-sm font-medium">Menu</p>
                {booking.cart.length > 0 && (
                  <button
                    onClick={() => void assistant?.sendTranscript("that's it, I'm done")}
                    className="px-4 py-1.5 rounded-full bg-[#C8A951] text-black text-xs font-medium"
                  >
                    Done ({booking.cart.length} items)
                  </button>
                )}
              </div>

              {Object.keys(grouped).length === 0 && (
                <p className="text-white/30 text-sm text-center py-6">
                  No pre-orderable items available
                </p>
              )}

              {Object.entries(grouped).map(([category, items]) => (
                <div key={category}>
                  <p className="text-white/50 text-xs uppercase tracking-wide mb-2">{category}</p>
                  <div className="space-y-2">
                    {items.map((item) => {
                      const qty = cartMap.get(item.id) ?? 0;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between bg-white/5 rounded-xl px-3 py-2.5"
                        >
                          <div className="flex-1 min-w-0 pr-3">
                            <p className="text-white text-sm font-medium truncate">{item.name}</p>
                            <p className="text-[#C8A951] text-xs">{formatCurrency(item.price)}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {qty > 0 ? (
                              <>
                                <button
                                  onClick={() => removeItem(item.id)}
                                  className="w-7 h-7 rounded-full border border-white/20 flex items-center justify-center text-white/60 hover:border-white/40 transition-colors"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="text-white text-sm w-4 text-center">{qty}</span>
                              </>
                            ) : null}
                            <button
                              onClick={() => addItem(item)}
                              className="w-7 h-7 rounded-full bg-[#C8A951] flex items-center justify-center text-black hover:bg-[#E6C060] transition-colors"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {booking.cart.length > 0 && (
                <div className="border-t border-white/10 pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Subtotal</span>
                    <span className="text-white">{formatCurrency(booking.cart_subtotal)}</span>
                  </div>
                  <Button
                    className="w-full bg-[#C8A951] text-black hover:bg-[#E6C060]"
                    onClick={() => void assistant?.sendTranscript("that's it, I'm done ordering")}
                  >
                    Review order
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Review cart + tip timing ─────────────────────────────────────── */}
          {(booking.status === "reviewing_cart" || booking.status === "choosing_tip_timing") && (
            <div className="space-y-3">
              <p className="text-white text-sm font-medium mb-2">Your order</p>
              {booking.cart.map((item) => (
                <div key={item.menu_item_id} className="flex justify-between text-sm">
                  <span className="text-white/70">{item.qty}× {item.name}</span>
                  <span className="text-white/60">{formatCurrency(item.unit_price * item.qty)}</span>
                </div>
              ))}
              <div className="border-t border-white/10 pt-2 flex justify-between text-sm font-medium">
                <span className="text-white/60">Subtotal</span>
                <span className="text-white">{formatCurrency(booking.cart_subtotal)}</span>
              </div>

              <p className="text-white/70 text-sm text-center pt-2">Add a tip?</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => void assistant?.sendTranscript("tip now")}
                  className="px-5 py-2 rounded-full bg-[#C8A951] text-black text-sm font-medium hover:bg-[#E6C060] transition-colors"
                >
                  Tip now
                </button>
                <button
                  onClick={() => void assistant?.sendTranscript("tip after")}
                  className="px-5 py-2 rounded-full border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                >
                  Pay at table
                </button>
              </div>
            </div>
          )}

          {/* ── Choose tip amount ────────────────────────────────────────────── */}
          {booking.status === "choosing_tip_amount" && (
            <div className="space-y-3">
              <p className="text-white text-sm font-medium mb-1">Subtotal: {formatCurrency(booking.cart_subtotal)}</p>
              <p className="text-white/70 text-sm">How much would you like to tip?</p>
              <div className="grid grid-cols-3 gap-2">
                {[15, 18, 20].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => applyTipPercent(pct)}
                    className="py-3 rounded-xl border border-white/20 text-white text-sm hover:border-[#C8A951] hover:text-[#C8A951] transition-colors"
                  >
                    {pct}%
                    <br />
                    <span className="text-white/40 text-xs">
                      {formatCurrency(Math.round(booking.cart_subtotal * (pct / 100) * 100) / 100)}
                    </span>
                  </button>
                ))}
              </div>

              {showCustomTip ? (
                <div className="flex gap-2">
                  <input
                    value={customTipInput}
                    onChange={(e) => setCustomTipInput(e.target.value)}
                    placeholder="e.g. 25 or $12"
                    className="flex-1 bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#C8A951]"
                    autoFocus
                  />
                  <button
                    onClick={applyCustomTip}
                    disabled={!customTipInput.trim()}
                    className="px-4 py-2 rounded-lg bg-[#C8A951] text-black text-sm disabled:opacity-40"
                  >
                    Apply
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowCustomTip(true)}
                  className="w-full py-2 rounded-lg border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                >
                  Custom amount
                </button>
              )}
            </div>
          )}

          {/* ── Choose payment split ─────────────────────────────────────────── */}
          {booking.status === "choosing_payment_split" && (
            <div className="space-y-4">
              <div className="bg-white/5 rounded-xl p-3 space-y-1 text-sm">
                {booking.cart.map((item) => (
                  <div key={item.menu_item_id} className="flex justify-between">
                    <span className="text-white/60">{item.qty}× {item.name}</span>
                    <span className="text-white/60">{formatCurrency(item.unit_price * item.qty)}</span>
                  </div>
                ))}
                {tipDisplay && (
                  <div className="flex justify-between text-[#C8A951]">
                    <span>Tip ({tipDisplay})</span>
                    <span>{formatCurrency(tipDollars)}</span>
                  </div>
                )}
                <div className="border-t border-white/10 pt-1 flex justify-between font-medium text-white">
                  <span>Total</span>
                  <span>{formatCurrency(totalWithTip)}</span>
                </div>
              </div>
              <p className="text-white/70 text-sm text-center">How would you like to pay?</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => void assistant?.sendTranscript("single card")}
                  className="px-5 py-2.5 rounded-full bg-[#C8A951] text-black text-sm font-medium hover:bg-[#E6C060] transition-colors"
                >
                  Single card
                </button>
                <button
                  onClick={() => void assistant?.sendTranscript("split between guests")}
                  className="px-5 py-2.5 rounded-full border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                >
                  Split
                </button>
              </div>
            </div>
          )}

          {/* ── Charging ─────────────────────────────────────────────────────── */}
          {booking.status === "charging" && (
            <div className="py-8 text-center">
              <div className="w-10 h-10 border-2 border-[#C8A951] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-white/60 text-sm">Charging your card…</p>
            </div>
          )}

          {/* ── Availability slots ───────────────────────────────────────────── */}
          {booking.status === "loading_availability" && availability.loading && (
            <div className="py-6 text-center text-white/50 text-sm">Loading slots…</div>
          )}

          {booking.status === "awaiting_time_selection" && availability.slots.length > 0 && (
            <div className="space-y-2">
              <p className="text-white/60 text-sm mb-3">Pick a time:</p>
              <div className="grid grid-cols-3 gap-2">
                {availability.slots.map((slot) => (
                  <button
                    key={slot.date_time}
                    onClick={() => handleSlotSelect(slot)}
                    className={cn(
                      "py-2 rounded-lg text-sm border transition-colors",
                      booking.slot_iso === slot.date_time
                        ? "bg-[#C8A951] text-black border-[#C8A951]"
                        : "border-white/20 text-white hover:border-[#C8A951]",
                    )}
                  >
                    {slot.display_time}
                  </button>
                ))}
              </div>

              {/* Compact Confirm Booking card — appears once a slot is chosen.
                  Shows restaurant + date + time + party size so the user can
                  review at a glance, with Confirm / Change on the same row. */}
              {booking.slot_iso && (
                <motion.div
                  key="confirm-card"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="mt-3 rounded-xl border border-[#C8A951]/40 bg-[#C8A951]/5 px-3 py-3"
                >
                  <p className="text-white/50 text-xs uppercase tracking-wide mb-2">
                    Review booking
                  </p>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {booking.restaurant_name && (
                        <p className="text-white text-sm font-medium truncate">
                          {booking.restaurant_name}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-white/60 text-xs">
                        {booking.party_size && (
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" />{booking.party_size}
                          </span>
                        )}
                        {booking.date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {(() => {
                              try { return format(new Date(booking.date), "MMM d"); } catch { return booking.date; }
                            })()}
                          </span>
                        )}
                        {(() => {
                          const slot = availability.slots.find(
                            (s) => s.date_time === booking.slot_iso,
                          );
                          const label = slot?.display_time ?? booking.time;
                          return label ? (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />{label}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => {
                        // "Change" clears the chosen slot so the user can
                        // pick a different time without going back through
                        // the orchestrator. We don't reset shift_id because
                        // the slot grid is still the same shift.
                        dispatch({
                          type: "select_time_slot",
                          slot_iso: "",
                          shift_id: booking.shift_id ?? "",
                        });
                      }}
                      className="flex-1 py-2 rounded-lg border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                    >
                      Change
                    </button>
                    <button
                      onClick={handleConfirm}
                      className="flex-1 py-2 rounded-lg bg-[#C8A951] text-black text-sm font-medium hover:bg-[#E6C060] transition-colors"
                    >
                      Confirm
                    </button>
                  </div>
                </motion.div>
              )}
            </div>
          )}

          {/* ── Confirming state ─────────────────────────────────────────────── */}
          {booking.status === "confirming" && (
            <div className="py-6 text-center text-white/60 text-sm">
              Securing your reservation…
            </div>
          )}

          {/* ── Collect minimum fields via voice ─────────────────────────────── */}
          {booking.status === "collecting_minimum_fields" &&
            booking.restaurant_id && booking.date && booking.party_size && (
            <div className="flex justify-center">
              <Button
                className="bg-[#C8A951] text-black hover:bg-[#E6C060] text-sm"
                onClick={handleLoadAvailability}
              >
                See available times
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

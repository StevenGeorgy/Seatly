import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Calendar, Clock, Users, CheckCircle2, Plus, Minus, ShoppingCart, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useAvailability } from "@/hooks/useAvailability";
import { usePublicMenuItems, usePublicMenuCategories } from "@/hooks/useMenuItems";
import { useUser } from "@/hooks/useUser";
import { ExitButton } from "@/components/cenaiva/ExitButton";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatCompactTimeLabel, formatCompactTimeLabelInTz } from "@/lib/utils/time";
import { toUserFacingError, useErrorToast } from "@/lib/errors";

interface BookingSheetProps {
  onExit: () => void;
  /** When true, the sheet fills the full available screen (used for the
   *  manual menu / prepay flow where map + rail are hidden). */
  fullScreen?: boolean;
}

/** Statuses where the BookingSheet is driving a fully manual, button-only
 *  menu + prepay UI. No orchestrator calls, no auto-listen. Kept here next
 *  to the component so the shell can import the same check. */
export const MANUAL_MENU_STATUSES = new Set([
  "offering_preorder",
  "browsing_menu",
]);

function formatCurrency(amount: number) {
  return `$${amount.toFixed(2)}`;
}

export function BookingSheet({ onExit, fullScreen }: BookingSheetProps) {
  const { state, dispatch } = useAssistantStore();
  const assistant = useAssistant();
  const availability = useAvailability();
  const navigate = useNavigate();
  const { profile } = useUser();
  const { errorToast } = useErrorToast();
  const { booking, showExitX } = state;
  const [prepayBusy, setPrepayBusy] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState<string | null>(null);
  const lastAvailabilityLookupKeyRef = useRef<string | null>(null);
  // B3 (2026-05-17): local guard so rapid clicks on "Confirm booking" don't
  // each fire a `force: true` sendTranscript (which cancels the in-flight
  // orchestrator turn — wasteful and visually confusing). The ref handles
  // sub-render-frame double-clicks; the state drives the disabled+spinner UI.
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmingRef = useRef(false);

  // Local-only review/prepay flow — no orchestrator involvement. Once the
  // user is done picking items in `browsing_menu`, the "Review order" button
  // switches to "review" which shows the cart + optional prepay prompt.
  const [menuStep, setMenuStep] = useState<"browsing" | "review">("browsing");

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
  const [restaurantTimezone, setRestaurantTimezone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const restaurantId = booking.restaurant_id;
    if (!restaurantId) {
      void Promise.resolve().then(() => {
        if (!cancelled) setRestaurantTimezone(null);
      });
      return () => { cancelled = true; };
    }
    const client = getSupabaseBrowserClient();
    void client
      .from("restaurants")
      .select("timezone")
      .eq("id", restaurantId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setRestaurantTimezone(typeof data?.timezone === "string" ? data.timezone : null);
      });
    return () => { cancelled = true; };
  }, [booking.restaurant_id]);

  // `offering_preorder` keeps the confirmation card visible while the preorder
  // Yes/No buttons are shown underneath — see the offer_preorder branch below.
  const isConfirmed =
    booking.status === "confirmed" ||
    booking.status === "offering_preorder" ||
    booking.status === "post_booking";
  const isPostBooking = booking.status === "post_booking";
  const isPaid = booking.status === "paid";

  const availabilityLookupKey = useMemo(() => {
    if (!booking.restaurant_id || !booking.date || !booking.party_size) return null;
    return `${booking.restaurant_id}:${booking.date}:${booking.party_size}`;
  }, [booking.date, booking.party_size, booking.restaurant_id]);

  const runAvailabilityLookup = useCallback(
    async (dispatchLoading: boolean) => {
      if (!booking.restaurant_id || !booking.date || !booking.party_size || !availabilityLookupKey) return;
      if (dispatchLoading) dispatch({ type: "load_availability" });

      lastAvailabilityLookupKeyRef.current = availabilityLookupKey;
      setAvailabilityNotice(null);

      const result = await availability.fetchSlots(
        booking.restaurant_id,
        booking.date,
        booking.party_size,
      );

      // Ignore stale responses after the user changes restaurant/date/party size.
      if (lastAvailabilityLookupKeyRef.current !== availabilityLookupKey) return;

      if (result.slots.length > 0) {
        dispatch({ type: "SET_BOOKING_STATUS", status: "awaiting_time_selection" });
        return;
      }

      dispatch({ type: "SET_BOOKING_STATUS", status: "collecting_minimum_fields" });
      const friendly = toUserFacingError(
        result.error ?? null,
        "I couldn't find available times for that date. Try another date or ask again.",
      );
      setAvailabilityNotice(friendly.message);
    },
    [
      availability.fetchSlots,
      availabilityLookupKey,
      booking.date,
      booking.party_size,
      booking.restaurant_id,
      dispatch,
    ],
  );

  useEffect(() => {
    if (booking.status !== "loading_availability") return;
    if (!availabilityLookupKey || availability.loading) return;
    if (lastAvailabilityLookupKeyRef.current === availabilityLookupKey) return;
    void runAvailabilityLookup(false);
  }, [
    availability.loading,
    availabilityLookupKey,
    booking.status,
    runAvailabilityLookup,
  ]);

  useEffect(() => {
    if (booking.status !== "loading_availability") {
      lastAvailabilityLookupKeyRef.current = null;
    }
  }, [booking.status]);

  const handleLoadAvailability = () => {
    void runAvailabilityLookup(true);
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

  /**
   * R2 / R1-A follow-on fix: one-click cancel from the post-booking success
   * card. The "You're booked!" card historically blocked the chat input
   * (users typed "cancel it" but the success card's special_request input
   * intercepted focus). This shortcut wires the cancel intent directly
   * through the orchestrator. The deterministic post-booking cancel guard
   * (post_booking + reservation_id + cancel verb) catches "cancel my
   * reservation" and emits the confirmation prompt with natural date+time.
   * Next user "yes" completes the cancel via the pending_action consumer.
   */
  const handleCancelFromSuccessCard = () => {
    void assistant?.sendTranscript("cancel my reservation");
  };

  /** Client-side "Yes, prepay" — bypasses the orchestrator entirely so the
   *  button feels like a direct link to checkout. The orchestrator round-trip
   *  (LLM turn + create_preorder_order tool call) added ~2-4s of latency
   *  during which the UI showed "Thinking..." and sometimes failed to emit
   *  navigate_to_checkout at all. We already have restaurant_id, reservation_id,
   *  and the authoritative cart in booking state; RLS allows authenticated
   *  guests to insert their own orders (same path manual checkout uses). */
  const handleYesPrepay = async () => {
    if (prepayBusy) return;
    if (!booking.restaurant_id || !booking.reservation_id || booking.cart.length === 0) {
      return;
    }
    setPrepayBusy(true);
    try {
      const client = getSupabaseBrowserClient();

      // Fetch slug + tax rate for URL + totals. Keep this lean (no join).
      const { data: rest, error: restErr } = await client
        .from("restaurants")
        .select("slug, tax_rate, currency")
        .eq("id", booking.restaurant_id)
        .single();
      if (restErr || !rest?.slug) throw new Error(restErr?.message ?? "Missing slug");

      const taxRate = rest.tax_rate ?? 0.13;
      const subtotal = booking.cart_subtotal;
      const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
      const total = Math.round((subtotal + taxAmount) * 100) / 100;
      const code = `SEAT-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

      // Look up the existing guest row for this user+restaurant. complete_booking
      // already created it server-side when the reservation was confirmed, so a
      // simple SELECT is enough — guests_select_own RLS lets the authenticated
      // user read their own guest rows. Without guest_id on the order, the
      // orders_select_own RLS policy blocks the deep-link SELECT later
      // (`?order_id=...&step=checkout`) and the page falls back to the manual
      // booking form instead of jumping to checkout.
      if (!profile?.id) throw new Error("Missing user profile");
      const { data: guestRow, error: guestErr } = await client
        .from("guests")
        .select("id")
        .eq("user_profile_id", profile.id)
        .eq("restaurant_id", booking.restaurant_id)
        .maybeSingle();
      if (guestErr || !guestRow?.id) {
        throw new Error(guestErr?.message ?? "Guest record missing — reservation may not be confirmed yet");
      }

      const { data: order, error: orderErr } = await client
        .from("orders")
        .insert({
          restaurant_id: booking.restaurant_id,
          guest_id: guestRow.id,
          reservation_id: booking.reservation_id,
          is_preorder: true,
          order_type: "dine_in",
          status: "pending",
          subtotal,
          tax_amount: taxAmount,
          total_amount: total,
          confirmation_code: code,
          source: "cenaiva",
        })
        .select("id")
        .single();
      if (orderErr || !order) throw new Error(orderErr?.message ?? "Order failed");

      const orderItems = booking.cart.map((item) => ({
        order_id: order.id,
        menu_item_id: item.menu_item_id,
        name: item.name,
        quantity: item.qty,
        unit_price: item.unit_price,
        line_total: Math.round(item.unit_price * item.qty * 100) / 100,
        status: "pending",
      }));
      const { error: itemsErr } = await client.from("order_items").insert(orderItems);
      if (itemsErr) {
        // Roll back the headless order so the user doesn't see a $0 orphan.
        await client.from("orders").delete().eq("id", order.id);
        throw new Error(itemsErr.message);
      }

      // Tear down the voice shell + navigate in one shot. AssistantProvider's
      // close() stops mic/TTS so we don't keep "Listening…" after the user
      // is already on the checkout page.
      assistant?.close();
      navigate(`/${rest.slug}?order_id=${order.id}&step=checkout`);
    } catch (err) {
      errorToast(err, {
        fallback: "Couldn't start prepay. Try again.",
        logTag: "[BookingSheet.handleYesPrepay]",
      });
      setPrepayBusy(false);
    }
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

  // ── Guard: nothing to show unless a branch below will render real content.
  // Every previous iteration of this guard missed an edge case — e.g. status
  // is "awaiting_time_selection" but availability.slots.length === 0 (slot
  // fetch in-flight from the orchestrator) leaves the wrapper motion.div
  // mounted with zero children, producing the empty black bar above the mic.
  // Instead of enumerating statuses, mirror the exact conditions of each
  // render branch below and bail if none match.
  const hasConfirmationCard = (isConfirmed || isPaid) && !!booking.confirmation_code;
  const hasOfferPreorder = booking.status === "offering_preorder";
  const hasBrowsingMenu = booking.status === "browsing_menu";
  const hasReviewingCart =
    booking.status === "reviewing_cart" || booking.status === "choosing_tip_timing";
  const hasTipAmount = booking.status === "choosing_tip_amount";
  const hasPaymentSplit = booking.status === "choosing_payment_split";
  const hasCharging = booking.status === "charging";
  const hasLoadingAvailability =
    booking.status === "loading_availability" && availability.loading;
  const hasConfirming = booking.status === "confirming";
  const hasCollectingCTA =
    booking.status === "collecting_minimum_fields" &&
    !!booking.restaurant_id && !!booking.date && !!booking.party_size;

  const hasAnyContent =
    hasConfirmationCard ||
    hasOfferPreorder ||
    hasBrowsingMenu ||
    hasReviewingCart ||
    hasTipAmount ||
    hasPaymentSplit ||
    hasCharging ||
    hasLoadingAvailability ||
    hasConfirming ||
    hasCollectingCTA;

  if (!hasAnyContent) return null;

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
        className={cn(
          "z-40 bg-[#111] border-t border-white/10 overflow-hidden",
          fullScreen
            ? "absolute inset-0 rounded-none"
            : "absolute bottom-0 left-0 right-0 rounded-t-2xl",
        )}
      >
        {showExitX && <ExitButton onExit={onExit} />}

        <div
          className={cn(
            "p-4 overflow-y-auto",
            fullScreen ? "h-full" : "max-h-[65vh]",
          )}
        >

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
                {(booking.date || booking.slot_iso) && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {(() => {
                      // booking.date is the customer-facing local reservation
                      // date. Prefer it over slot_iso so UTC storage never
                      // shifts the summary to the wrong calendar day.
                      if (booking.date) {
                        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(booking.date);
                        if (m) {
                          const local = new Date(
                            parseInt(m[1], 10),
                            parseInt(m[2], 10) - 1,
                            parseInt(m[3], 10),
                          );
                          try { return format(local, "MMM d"); } catch { return booking.date; }
                        }
                        try { return format(new Date(booking.date), "MMM d"); } catch { return booking.date; }
                      }
                      if (booking.slot_iso) {
                        try { return format(new Date(booking.slot_iso), "MMM d"); } catch { /* fall through */ }
                      }
                      return null;
                    })()}
                  </span>
                )}
                {(booking.time || booking.slot_iso) && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    {(() => {
                      // booking.time is the customer-facing local time we
                      // confirmed. Prefer it over slot_iso for summary display.
                      const t = booking.time ?? "";
                      if (/[AaPp][Mm]\b/.test(t)) return t;
                      const m = /^(\d{1,2}):(\d{2})/.exec(t);
                      if (m) {
                        let h = parseInt(m[1], 10);
                        const period = h >= 12 ? "PM" : "AM";
                        if (h === 0) h = 12;
                        else if (h > 12) h -= 12;
                        return formatCompactTimeLabel(`${h}:${m[2]} ${period}`);
                      }
                      if (booking.slot_iso) {
                        try {
                          return formatCompactTimeLabelInTz(new Date(booking.slot_iso), restaurantTimezone);
                        } catch { /* fall through */ }
                      }
                      return t;
                    })()}
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

              {/* Subtle one-click cancel — the special_request input above used
                  to intercept focus when users tried to type "cancel it" in
                  the chat. This shortcut routes through the orchestrator's
                  deterministic post-booking cancel guard for a 2-turn cancel
                  with the natural date+time confirmation prompt. */}
              <div className="pt-1 text-center">
                <button
                  type="button"
                  onClick={handleCancelFromSuccessCard}
                  className="text-white/40 hover:text-white/70 text-xs underline underline-offset-2 transition-colors"
                >
                  Cancel this reservation
                </button>
              </div>
            </div>
          )}

          {/* ── Offer pre-order ──────────────────────────────────────────────── */}
          {booking.status === "offering_preorder" && (
            <div className="py-4 text-center space-y-4">
              <ShoppingCart className="w-10 h-10 text-[#C8A951] mx-auto" />
              <p className="text-white text-sm">Would you like to browse the menu?</p>
              <p className="text-white/40 text-xs">Pre-order is optional — you can also just pay at the table.</p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => {
                    // Manual flow: stay inside the Cenaiva shell and advance
                    // the booking status locally so BookingSheet renders the
                    // menu. No orchestrator round-trip, no TTS prompt.
                    setMenuStep("browsing");
                    dispatch({ type: "SET_BOOKING_STATUS", status: "browsing_menu" });
                  }}
                  className="px-6 py-2.5 rounded-full bg-[#C8A951] text-black text-sm font-medium hover:bg-[#E6C060] transition-colors"
                >
                  Yes, show menu
                </button>
                <button
                  onClick={() => {
                    // "No" ends the flow right here — no orchestrator round-trip.
                    // Cenaiva says bye, the shell closes, and we land on /account.
                    void assistant?.sayGoodbyeAndClose(
                      "You're all set. Enjoy your meal. Bye!",
                      "/account",
                    );
                  }}
                  className="px-6 py-2.5 rounded-full border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                >
                  No thanks
                </button>
              </div>
            </div>
          )}

          {/* ── Browse menu (manual, button-driven) ──────────────────────────── */}
          {booking.status === "browsing_menu" && menuStep === "browsing" && (
            <div className="space-y-4 pb-2">
              <div className="flex items-center justify-between">
                <p className="text-white text-base font-medium">Menu</p>
                <p className="text-white/40 text-xs">Add items, then review</p>
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
                <div className="sticky bottom-0 -mx-4 -mb-4 px-4 pt-3 pb-4 bg-[#111] border-t border-white/10 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-white/60">Subtotal</span>
                    <span className="text-white">{formatCurrency(booking.cart_subtotal)}</span>
                  </div>
                  <Button
                    className="w-full bg-[#C8A951] text-black hover:bg-[#E6C060]"
                    onClick={() => setMenuStep("review")}
                  >
                    Review order
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* ── Review order + optional prepay (manual) ──────────────────────── */}
          {booking.status === "browsing_menu" && menuStep === "review" && (
            <div className="space-y-4">
              <p className="text-white text-base font-medium">Review your order</p>

              <div className="space-y-2">
                {booking.cart.map((item) => (
                  <div
                    key={item.menu_item_id}
                    className="flex justify-between bg-white/5 rounded-xl px-3 py-2.5 text-sm"
                  >
                    <span className="text-white/80">{item.qty}× {item.name}</span>
                    <span className="text-white/60">
                      {formatCurrency(item.unit_price * item.qty)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-white/10 pt-3 flex justify-between text-sm font-medium">
                <span className="text-white/60">Subtotal</span>
                <span className="text-white">{formatCurrency(booking.cart_subtotal)}</span>
              </div>

              <button
                onClick={() => setMenuStep("browsing")}
                className="w-full py-2 rounded-lg border border-white/15 text-white/60 text-xs hover:border-white/30 transition-colors"
              >
                ← Edit items
              </button>

              <div className="pt-2 text-center space-y-3">
                <p className="text-white text-sm">Would you like to prepay now?</p>
                <p className="text-white/40 text-xs">
                  Optional — skip if you'd rather pay at the table.
                </p>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={() => void handleYesPrepay()}
                    disabled={prepayBusy}
                    className="px-5 py-2.5 rounded-full bg-[#C8A951] text-black text-sm font-medium hover:bg-[#E6C060] transition-colors disabled:opacity-60"
                  >
                    {prepayBusy ? "…" : "Yes, prepay"}
                  </button>
                  <button
                    onClick={() => {
                      void assistant?.sayGoodbyeAndClose(
                        "Great, you can pay at the table. See you soon. Bye!",
                        "/account",
                      );
                    }}
                    className="px-5 py-2.5 rounded-full border border-white/20 text-white/60 text-sm hover:border-white/40 transition-colors"
                  >
                    No, pay at table
                  </button>
                </div>
              </div>
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

          {/* ── Confirming state ─────────────────────────────────────────────── */}
          {booking.status === "confirming" && (
            <div className="py-4 space-y-4">
              <div className="text-center">
                <p className="text-white text-base font-medium">Confirm reservation</p>
                <p className="text-white/45 text-xs mt-1">Review the details before Cenaiva books it.</p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 space-y-2 text-sm">
                {booking.restaurant_name && (
                  <div className="flex justify-between gap-3">
                    <span className="text-white/45">Restaurant</span>
                    <span className="text-white text-right">{booking.restaurant_name}</span>
                  </div>
                )}
                {booking.party_size && (
                  <div className="flex justify-between gap-3">
                    <span className="text-white/45">Guests</span>
                    <span className="text-white">{booking.party_size}</span>
                  </div>
                )}
                {booking.date && (
                  <div className="flex justify-between gap-3">
                    <span className="text-white/45">Date</span>
                    <span className="text-white">
                      {(() => {
                        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(booking.date ?? "");
                        if (!m) return booking.date;
                        const local = new Date(
                          parseInt(m[1], 10),
                          parseInt(m[2], 10) - 1,
                          parseInt(m[3], 10),
                        );
                        try { return format(local, "EEE, MMM d"); } catch { return booking.date; }
                      })()}
                    </span>
                  </div>
                )}
                {(booking.time || booking.slot_iso) && (
                  <div className="flex justify-between gap-3">
                    <span className="text-white/45">Time</span>
                    <span className="text-white">
                      {(() => {
                        const t = booking.time ?? "";
                        if (/[AaPp][Mm]\b/.test(t)) return t;
                        const m = /^(\d{1,2}):(\d{2})/.exec(t);
                        if (m) {
                          let h = parseInt(m[1], 10);
                          const period = h >= 12 ? "PM" : "AM";
                          if (h === 0) h = 12;
                          else if (h > 12) h -= 12;
                          return formatCompactTimeLabel(`${h}:${m[2]} ${period}`);
                        }
                        if (booking.slot_iso) {
                          try {
                            return formatCompactTimeLabelInTz(new Date(booking.slot_iso), restaurantTimezone);
                          } catch { /* fall through */ }
                        }
                        return t;
                      })()}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex gap-3 justify-center">
                <Button
                  type="button"
                  className="bg-[#C8A951] text-black hover:bg-[#E6C060] text-sm"
                  disabled={isConfirming || !!assistant?.isProcessing}
                  onClick={async () => {
                    if (confirmingRef.current) return;
                    confirmingRef.current = true;
                    setIsConfirming(true);
                    try {
                      await assistant?.sendTranscript("yes, confirm booking", { force: true });
                    } finally {
                      confirmingRef.current = false;
                      setIsConfirming(false);
                    }
                  }}
                >
                  {isConfirming || assistant?.isProcessing ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Confirming…
                    </span>
                  ) : (
                    "Confirm booking"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="border-white/20 text-white/60 hover:bg-white/5 text-sm"
                  onClick={() => void assistant?.sendTranscript("change the booking details", { force: true })}
                >
                  Change details
                </Button>
              </div>
            </div>
          )}

          {/* ── Collect minimum fields via voice ─────────────────────────────── */}
          {booking.status === "collecting_minimum_fields" &&
            booking.restaurant_id && booking.date && booking.party_size && (
            <div className="space-y-3">
              {availabilityNotice && (
                <p className="text-center text-xs text-white/50">{availabilityNotice}</p>
              )}
              <div className="flex justify-center">
                <Button
                  className="bg-[#C8A951] text-black hover:bg-[#E6C060] text-sm"
                  onClick={handleLoadAvailability}
                >
                  See available times
                </Button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

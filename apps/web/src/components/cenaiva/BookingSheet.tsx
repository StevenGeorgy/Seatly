import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, Clock, Users, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { useAssistant } from "@/components/cenaiva/AssistantProvider";
import { useAvailability } from "@/hooks/useAvailability";
import { ExitButton } from "@/components/cenaiva/ExitButton";

interface BookingSheetProps {
  onExit: () => void;
}

export function BookingSheet({ onExit }: BookingSheetProps) {
  const { state, dispatch } = useAssistantStore();
  const assistant = useAssistant();
  const availability = useAvailability();
  const { booking, showExitX } = state;

  const [specialRequest, setSpecialRequest] = useState("");
  const [occasion, setOccasion] = useState("");

  const isConfirmed = booking.status === "confirmed" || booking.status === "post_booking";
  const isPostBooking = booking.status === "post_booking";

  // Load slots when date + party_size known
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
      void assistant?.sendTranscript(parts.join(", "));
    } else {
      onExit();
    }
  };

  if (booking.status === "idle" || booking.status === "collecting_minimum_fields") return null;

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

        <div className="p-4 max-h-[60vh] overflow-y-auto">
          {/* Confirmation screen */}
          {isConfirmed && booking.confirmation_code && (
            <div className="text-center py-4">
              <CheckCircle2 className="w-12 h-12 text-[#C8A951] mx-auto mb-3" />
              <h2 className="text-white text-lg font-semibold">You're booked!</h2>
              <p className="text-white/60 text-sm mt-1">
                Confirmation: <span className="text-[#C8A951] font-mono">{booking.confirmation_code}</span>
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
            </div>
          )}

          {/* Post-booking extras */}
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

          {/* Availability slots */}
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
              {booking.slot_iso && (
                <Button
                  className="w-full mt-3 bg-[#C8A951] text-black hover:bg-[#E6C060]"
                  onClick={handleConfirm}
                >
                  Confirm booking
                </Button>
              )}
            </div>
          )}

          {/* Confirming state */}
          {booking.status === "confirming" && (
            <div className="py-6 text-center text-white/60 text-sm">
              Securing your reservation…
            </div>
          )}

          {/* Collect minimum fields via voice prompts — show what's known */}
          {booking.status === "collecting_minimum_fields" && (
            <div className="space-y-3">
              <p className="text-white/70 text-sm text-center">Tell the assistant the details, or tap below:</p>

              <div className="flex gap-2 flex-wrap justify-center">
                {!booking.party_size && (
                  <button
                    onClick={() => assistant?.sendTranscript("party size")}
                    className="px-3 py-1.5 rounded-full text-sm border border-white/20 text-white/60 hover:border-[#C8A951] hover:text-white transition-colors"
                  >
                    👥 Party size?
                  </button>
                )}
                {!booking.date && (
                  <button
                    onClick={() => assistant?.sendTranscript("today")}
                    className="px-3 py-1.5 rounded-full text-sm border border-white/20 text-white/60 hover:border-[#C8A951] hover:text-white transition-colors"
                  >
                    📅 Date?
                  </button>
                )}
                {booking.restaurant_id && booking.date && booking.party_size && (
                  <Button
                    className="bg-[#C8A951] text-black hover:bg-[#E6C060] text-sm"
                    onClick={handleLoadAvailability}
                  >
                    See available times
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

import type { ChatMessage } from "@/hooks/useCenaivaChat";
import { cn } from "@/lib/utils";
import { Bot, CalendarCheck, CheckCircle, CreditCard, ExternalLink, ShoppingBag, User } from "lucide-react";
import { useNavigate } from "react-router-dom";

function ActionCard({ action }: { action: { type: string; data: Record<string, any> } }) {
  const navigate = useNavigate();

  // ── Booking confirmed (dine-in reservation + order, or takeout/delivery order) ──
  if (action.type === "complete_booking_completed") {
    const isDineIn = action.data.order_type === "dine_in";
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-emerald-400">
          {isDineIn ? <CalendarCheck className="h-4 w-4" /> : <ShoppingBag className="h-4 w-4" />}
          {isDineIn ? "Reservation & order confirmed" : "Order confirmed"}
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-gray-400">
          {action.data.confirmation_code && (
            <div>Code: <span className="font-mono font-medium text-gray-200">{action.data.confirmation_code}</span></div>
          )}
          {action.data.items_ordered && <div>{action.data.items_ordered}</div>}
          {action.data.total != null && (
            <div>
              Total: <span className="font-medium text-gray-200">
                {action.data.currency || "CA$"}{action.data.total.toFixed(2)}
              </span>
              {" "}(before tip)
            </div>
          )}
        </div>
        {action.data.checkout_url && (
          <button
            onClick={() => navigate(action.data.checkout_url)}
            className="mt-2 flex items-center gap-1 text-xs text-[#C8A951] hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Go to checkout
          </button>
        )}
      </div>
    );
  }

  // ── Payment confirmed ──
  if (action.type === "charge_saved_card_completed") {
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-emerald-400">
          <CheckCircle className="h-4 w-4" />
          Payment confirmed
        </div>
        <div className="mt-1 space-y-0.5 text-xs text-gray-400">
          {action.data.total_charged != null && (
            <div>
              Charged:{" "}
              <span className="font-medium text-gray-200">
                {action.data.currency || "CA$"}{Number(action.data.total_charged).toFixed(2)}
              </span>
            </div>
          )}
          {action.data.card_brand && action.data.card_last4 && (
            <div className="flex items-center gap-1">
              <CreditCard className="h-3 w-3" />
              {action.data.card_brand} ****{action.data.card_last4}
              {action.data.mode === "test" && (
                <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-400">test</span>
              )}
            </div>
          )}
          {action.data.tip_amount > 0 && (
            <div>Tip: {action.data.currency || "CA$"}{Number(action.data.tip_amount).toFixed(2)}</div>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export function CenaivaMessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const actions = message.metadata?.actions as
    | { type: string; data: Record<string, any> }[]
    | undefined;

  return (
    <div className={cn("flex gap-2", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs",
          isUser
            ? "bg-[#C8A951]/20 text-[#C8A951]"
            : "bg-white/10 text-white",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-[#C8A951]/15 text-white"
            : "bg-[#2A2A2A] text-gray-200",
        )}
      >
        {/* Render content with basic line breaks */}
        {message.content.split("\n").map((line, i) => (
          <span key={i}>
            {line}
            {i < message.content.split("\n").length - 1 && <br />}
          </span>
        ))}

        {/* Action cards */}
        {actions?.map((action, i) => (
          <ActionCard key={i} action={action} />
        ))}
      </div>
    </div>
  );
}

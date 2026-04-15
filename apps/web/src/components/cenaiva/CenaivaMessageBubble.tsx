import type { ChatMessage } from "@/hooks/useCenaivaChat";
import { cn } from "@/lib/utils";
import { Bot, CalendarCheck, ShoppingBag, User } from "lucide-react";

function ActionCard({ action }: { action: { type: string; data: Record<string, any> } }) {
  if (action.type === "create_reservation_completed") {
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-emerald-400">
          <CalendarCheck className="h-4 w-4" />
          Reservation booked
        </div>
        {action.data.confirmation_code && (
          <div className="mt-1 text-xs text-muted-foreground">
            Confirmation: {action.data.confirmation_code}
          </div>
        )}
      </div>
    );
  }

  if (action.type === "place_order_completed") {
    return (
      <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 font-medium text-amber-400">
          <ShoppingBag className="h-4 w-4" />
          Order placed
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {action.data.confirmation_code && <>Code: {action.data.confirmation_code} &middot; </>}
          {action.data.total != null && <>Total: {action.data.currency || "CA$"}{action.data.total.toFixed(2)}</>}
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

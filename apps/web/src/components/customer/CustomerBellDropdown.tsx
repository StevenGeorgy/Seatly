import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/hooks/useNotifications";

// Customer-facing bell + dropdown. Mirrors DashboardTopBar's pattern so the
// behavior (mark-read on click, deep-link via data.route, realtime-driven
// unread badge) is identical wherever notifications surface in Cenaiva.
// The "View all" link routes to /notifications, which has the full inbox +
// "My alerts" tab for managing active availability_alerts.
export function CustomerBellDropdown({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead } = useNotifications();

  const visible = notifications.slice(0, 8);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Notifications"
          className={cn("relative text-text-secondary hover:text-white", className)}
        >
          <Bell className="size-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 font-mono text-[11px] font-bold text-black">
              {Math.min(unreadCount, 9)}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">Notifications</p>
            {unreadCount > 0 && (
              <p className="text-xs text-text-muted">{unreadCount} unread</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate("/notifications")}
            className="text-xs font-medium text-gold transition-colors hover:text-gold/80"
          >
            View all
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              No notifications yet.
            </p>
          ) : (
            visible.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  void markRead(n.id);
                  const route = n.data?.route;
                  if (typeof route === "string" && route) {
                    navigate(route);
                  }
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-bg-elevated/60",
                  !n.is_read && "bg-gold/5",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className={cn("text-xs font-medium", !n.is_read ? "text-text-primary" : "text-text-secondary")}>
                    {n.title}
                  </span>
                  {!n.is_read && (
                    <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-gold" />
                  )}
                </div>
                {n.body ? (
                  <span className="line-clamp-2 text-xs text-text-muted">{n.body}</span>
                ) : null}
                <span className="text-[10px] text-text-muted">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

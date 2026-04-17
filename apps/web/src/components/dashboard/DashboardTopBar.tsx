import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { Bell, LogOut } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useUser } from "@/hooks/useUser";
import { useNotifications } from "@/hooks/useNotifications";
import { resolveDashboardPageLabelKey } from "@/lib/auth/dashboard-access";

export function DashboardTopBar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useUser();
  const { notifications, unreadCount, markRead } = useNotifications();
  const titleKey = resolveDashboardPageLabelKey(pathname);
  const isFloorPlanRoute = pathname.includes("/floor-plan");

  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border px-4 sm:px-6",
        isFloorPlanRoute
          ? "bg-bg-surface"
          : "bg-card/60 backdrop-blur-xl",
      )}
    >
      <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
        {t(titleKey)}
      </h2>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden max-w-[10rem] truncate text-sm text-muted-foreground sm:inline">
          {profile?.full_name ?? profile?.email ?? ""}
        </span>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Bell className="size-4" />
              {unreadCount > 0 && (
                <span className="absolute right-0.5 top-0.5 flex size-2 items-center justify-center rounded-full bg-destructive" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-text-primary">Notifications</p>
              {unreadCount > 0 && (
                <p className="text-xs text-text-muted">{unreadCount} unread</p>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-text-muted">No notifications yet.</p>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      void markRead(n.id);
                      if (n.data?.route && typeof n.data.route === "string") {
                        navigate(n.data.route);
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

        <div className="h-4 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void signOut()}
          className="text-muted-foreground hover:text-destructive"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}

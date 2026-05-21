import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, BellOff, Clock, MapPin, Settings2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

import { CustomerNav } from "@/components/customer/CustomerNav";
import { CenaivaWordmark } from "@/components/brand/CenaivaWordmark";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNotifications } from "@/hooks/useNotifications";
import { useAvailabilityAlerts } from "@/hooks/useAvailabilityAlerts";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, refetch } = useNotifications();
  const { activeAlerts, alerts, loading, cancel } = useAvailabilityAlerts();
  const [tab, setTab] = useState<"inbox" | "alerts">("inbox");

  // History tab also shows fulfilled / cancelled / expired alerts so users
  // can confirm "yes, that alert was the one that fired."
  const otherAlerts = alerts.filter((a) => a.status !== "active");

  const handleMarkAllRead = async () => {
    for (const n of notifications) {
      if (!n.is_read) await markRead(n.id);
    }
    await refetch();
  };

  return (
    <div className="min-h-screen bg-background text-text-primary">
      <header className="sticky top-0 z-40 border-b border-border/40 bg-background/85 backdrop-blur-xl">
        <div className="flex h-[5.5rem] w-full items-center px-4 sm:px-5">
          <Link to="/" className="flex shrink-0 items-center" aria-label="Cenaiva home">
            <CenaivaWordmark />
          </Link>
          <CustomerNav />
          <div className="ml-auto" />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-white"
        >
          <ArrowLeft className="size-4" />
          Back
        </button>
        <h1 className="font-serif text-4xl text-white sm:text-5xl">Notifications</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Recent activity and the alerts you've set up.
        </p>

        <Link
          to="/account/notifications-preferences"
          className="mt-6 flex items-center justify-between gap-4 rounded-2xl border border-border bg-bg-surface px-5 py-4 transition-colors hover:border-gold/40"
        >
          <div className="flex items-center gap-3">
            <Settings2 className="size-5 text-gold" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white">Preferences</p>
              <p className="text-xs text-text-secondary">
                Choose which emails, texts, and per-restaurant marketing you
                receive.
              </p>
            </div>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
            Manage
          </span>
        </Link>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "inbox" | "alerts")} className="mt-8">
          <TabsList className="mb-6">
            <TabsTrigger value="inbox" className="gap-1.5">
              Inbox
              {unreadCount > 0 ? (
                <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 font-mono text-[10px] font-bold text-black">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="alerts" className="gap-1.5">
              My alerts
              {activeAlerts.length > 0 ? (
                <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-bg-elevated px-1.5 font-mono text-[10px] font-bold text-text-secondary">
                  {activeAlerts.length}
                </span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inbox">
            <div className="flex items-center justify-between">
              <p className="text-xs text-text-muted">{notifications.length} total</p>
              {unreadCount > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => void handleMarkAllRead()}>
                  Mark all read
                </Button>
              ) : null}
            </div>
            <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-bg-surface">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-text-muted">
                  <BellOff className="size-6 text-text-muted" />
                  No notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      void markRead(n.id);
                      const route = n.data?.route;
                      if (typeof route === "string" && route) navigate(route);
                    }}
                    className={cn(
                      "flex w-full flex-col gap-1 px-4 py-4 text-left transition-colors hover:bg-bg-elevated/60",
                      !n.is_read && "bg-gold/5",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className={cn("text-sm font-medium", !n.is_read ? "text-white" : "text-text-secondary")}>
                        {n.title}
                      </p>
                      {!n.is_read ? (
                        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-gold" />
                      ) : null}
                    </div>
                    {n.body ? (
                      <p className="text-xs text-text-secondary">{n.body}</p>
                    ) : null}
                    <p className="text-[11px] text-text-muted">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </p>
                  </button>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value="alerts">
            <p className="text-xs text-text-muted">
              {activeAlerts.length} active · we'll ping you the moment a spot opens.
            </p>
            <div className="mt-3 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-border bg-bg-surface px-4 py-6 text-center text-sm text-text-muted">
                  Loading...
                </div>
              ) : activeAlerts.length === 0 ? (
                <div className="rounded-2xl border border-border bg-bg-surface px-4 py-8 text-center text-sm text-text-muted">
                  <Bell className="mx-auto mb-2 size-6 text-text-muted" />
                  No active alerts. Tap "Notify me" on a booked-up restaurant or
                  event and we'll watch for openings.
                </div>
              ) : (
                activeAlerts.map((a) => {
                  const label = a.restaurant?.name ?? a.event?.name ?? "Unknown";
                  const detail = a.restaurant_id
                    ? `${a.date ? format(new Date(`${a.date}T00:00:00`), "EEE, MMM d") : ""}${
                        a.preferred_time ? ` · ${a.preferred_time.slice(0, 5)}` : ""
                      } · party of ${a.party_size} · ±${a.window_minutes} min`
                    : `${
                        a.event?.date ? format(new Date(`${a.event.date}T00:00:00`), "EEE, MMM d") : ""
                      } · party of ${a.party_size}`;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-bg-surface px-4 py-4"
                    >
                      <div className="min-w-0">
                        <p className="font-serif text-base text-white">{label}</p>
                        <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-text-secondary">
                          {a.restaurant_id ? <Clock className="size-3.5 text-gold" /> : <MapPin className="size-3.5 text-gold" />}
                          {detail}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void cancel(a.id)}
                        className="shrink-0 text-text-secondary hover:text-white"
                      >
                        Cancel
                      </Button>
                    </div>
                  );
                })
              )}

              {otherAlerts.length > 0 ? (
                <details className="mt-6 rounded-2xl border border-border bg-bg-surface px-4 py-3">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-text-muted">
                    Past alerts ({otherAlerts.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {otherAlerts.slice(0, 20).map((a) => {
                      const label = a.restaurant?.name ?? a.event?.name ?? "Unknown";
                      return (
                        <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-text-secondary">{label}</span>
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                              a.status === "fulfilled"
                                ? "bg-gold/15 text-gold"
                                : "bg-bg-elevated text-text-muted",
                            )}
                          >
                            {a.status}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

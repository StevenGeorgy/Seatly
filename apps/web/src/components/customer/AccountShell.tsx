// Shared account-area layout: back button + sidebar (avatar + nav) +
// content slot. Used by AccountPage AND all /account/* sub-pages so
// they share the same visual chrome.
//
// Sidebar items navigate to `/account?section=<id>`. AccountPage reads
// that param on mount and selects the matching tab. From a sub-page,
// clicking a sidebar item takes the user back to /account with the
// right tab open. The "Preferences" entry is highlighted on sub-pages
// since voice / connected-accounts / privacy / my-data / sign-in-
// history all live under it.
//
// Keep this in lock-step with AccountPage's ACCOUNT_NAV — both must
// list the same sections in the same order.

import { format } from "date-fns";
import { type LucideIcon, ArrowLeft, CalendarDays, CreditCard, LogOut, MessageCircle, Settings, ShoppingBag, Star } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@/hooks/useUser";
import { cn } from "@/lib/utils";

export type AccountSection =
  | "bookings"
  | "orders"
  | "reviews"
  | "concierge"
  | "payment"
  | "preferences";

const ACCOUNT_NAV: { id: AccountSection; label: string; icon: LucideIcon }[] = [
  { id: "bookings", label: "Bookings", icon: CalendarDays },
  { id: "orders", label: "Orders", icon: ShoppingBag },
  { id: "reviews", label: "Reviews", icon: Star },
  { id: "concierge", label: "Concierge", icon: MessageCircle },
  { id: "payment", label: "Payment", icon: CreditCard },
  { id: "preferences", label: "Preferences", icon: Settings },
];

export function AccountShell({
  activeSection,
  onSectionChange,
  children,
}: {
  activeSection?: AccountSection;
  /** Optional in-page handler. If omitted, sidebar clicks navigate to
   * /account?section=<id>. AccountPage passes this to set state inline. */
  onSectionChange?: (section: AccountSection) => void;
  children: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { profile, signOut } = useUser();

  const initials = (profile?.full_name ?? profile?.email ?? "SK")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const displayName = profile?.full_name ?? profile?.email ?? "Guest";
  const memberSince = profile?.created_at
    ? `Member since ${format(new Date(profile.created_at), "yyyy")}`
    : "Member";

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/discover");
  };

  const handleSectionClick = (section: AccountSection) => {
    if (onSectionChange) {
      onSectionChange(section);
      return;
    }
    navigate(`/account?section=${section}`);
  };

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      <main className="mx-auto w-full max-w-[1500px] px-5 py-6 sm:px-8 lg:px-12 lg:py-10">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white"
        >
          <ArrowLeft className="size-4 text-gold" />
          Back
        </button>

        <div className="mt-6 grid w-full gap-10 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-10 lg:self-start">
            <div className="rounded-3xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/20">
              <div className="flex items-center gap-4 p-2">
                <Avatar className="size-14 border border-gold/30">
                  <AvatarImage src={profile?.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-gold/10 text-gold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{displayName}</p>
                  <p className="text-xs text-text-muted">{memberSince}</p>
                </div>
              </div>

              <nav className="mt-6 space-y-2" aria-label="Account">
                {ACCOUNT_NAV.map((item) => {
                  const Icon = item.icon;
                  const active = activeSection === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSectionClick(item.id)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-colors",
                        active
                          ? "border border-gold/25 bg-gold/15 text-gold"
                          : "text-text-secondary hover:bg-bg-elevated hover:text-white",
                      )}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-white"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </nav>
            </div>
          </aside>

          <section className="min-w-0 max-w-5xl">{children}</section>
        </div>
      </main>
    </div>
  );
}

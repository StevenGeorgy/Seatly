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
// On phones (< md) the account area is a two-level list → detail flow,
// like the iOS Settings app: the menu shows first; tapping a section
// opens it full-screen with a Back button. Desktop (md+) always shows
// the sidebar + content side by side and ignores this.
//
// Keep this in lock-step with AccountPage's ACCOUNT_NAV — both must
// list the same sections in the same order.

import { useState } from "react";
import { format } from "date-fns";
import { type LucideIcon, ArrowLeft, CalendarDays, ChevronLeft, CreditCard, LogOut, MessageCircle, Settings, ShoppingBag, Sparkles, Star } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useUser } from "@/hooks/useUser";
import { getAccountOriginUrl } from "@/hooks/useTrackOrigin";
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
  const location = useLocation();
  const { profile, signOut } = useUser();

  // Sub-pages live under /account/<slug>. /account itself is the
  // section-tab landing page. Breadcrumb only shows on sub-pages so
  // users have an explicit single-click path back to the Preferences
  // tab they came from (the big Back button still exits Account).
  const isSubPage = location.pathname !== "/account";

  // Phone-only list → detail state. Sub-pages are already detail views, so
  // they start "open" (content shown). On the main page we start on the menu.
  const [mobileSectionOpen, setMobileSectionOpen] = useState(isSubPage);
  const showContentOnMobile = isSubPage || mobileSectionOpen;

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
    // Jump straight out of the Account area in one click. Origin is
    // tracked at the router level (useTrackOrigin) — falls back to
    // /discover when the user arrived here by direct URL.
    const origin = getAccountOriginUrl();
    navigate(origin ?? "/discover");
  };

  const handleSectionClick = (section: AccountSection) => {
    // Phone: open the section full-screen. Desktop ignores this flag.
    setMobileSectionOpen(true);
    if (onSectionChange) {
      onSectionChange(section);
      return;
    }
    navigate(`/account?section=${section}`);
  };

  return (
    <div className="min-h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom))] bg-bg-base text-text-primary md:min-h-screen">
      <main className="mx-auto w-full max-w-[1500px] px-5 pb-0 pt-6 sm:px-8 md:py-6 lg:px-12 lg:py-10">
        {/* Phone-only: Back to the account menu when a section is open. */}
        {mobileSectionOpen && !isSubPage && (
          <button
            type="button"
            onClick={() => setMobileSectionOpen(false)}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white md:hidden"
          >
            <ArrowLeft className="size-4 text-gold" />
            Back
          </button>
        )}

        <div className={cn("flex-wrap items-center gap-3", isSubPage ? "flex" : "hidden md:flex")}>
          <button
            type="button"
            onClick={handleBack}
            className="hidden items-center gap-2 rounded-full border border-border bg-bg-surface/70 px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:border-gold/40 hover:text-white md:inline-flex"
          >
            <ArrowLeft className="size-4 text-gold" />
            Back
          </button>
          {isSubPage ? (
            <Link
              to="/account?section=preferences"
              className="inline-flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-gold"
            >
              <ChevronLeft className="size-3.5" />
              Back to Preferences
            </Link>
          ) : null}
        </div>

        <div className="mt-6 grid w-full gap-10 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside
            className={cn(
              "lg:sticky lg:top-10 lg:self-start",
              showContentOnMobile ? "hidden md:block" : "block",
            )}
          >
            {/* Grey card on all sizes (consistent with desktop). On phones it
                stretches to fill the viewport so there's no empty space below
                the menu; desktop hugs its content (md:min-h-0). */}
            <div className="mb-12 min-h-[calc(100dvh-9.5rem-env(safe-area-inset-bottom))] rounded-3xl border border-border bg-bg-surface p-5 shadow-2xl shadow-black/20 md:mb-0 md:min-h-0">
              <button
                type="button"
                onClick={() => handleSectionClick("preferences")}
                className="flex w-full items-center gap-4 rounded-2xl p-2 text-left transition-colors hover:bg-bg-elevated"
                aria-label="Account settings"
              >
                <Avatar className="size-14 border border-gold/30">
                  <AvatarImage src={profile?.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-gold/10 text-gold">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold text-white">{displayName}</p>
                  <p className="text-xs text-text-muted">{memberSince}</p>
                </div>
              </button>

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
                        "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-white",
                        // Active highlight only from md up — on the phone menu nothing
                        // is pre-selected (tapping a row opens it full-screen instead).
                        active &&
                          "md:border md:border-gold/25 md:bg-gold/15 md:text-gold md:hover:bg-gold/15 md:hover:text-gold",
                      )}
                    >
                      <Icon className="size-4" />
                      {item.label}
                    </button>
                  );
                })}
                <Link
                  to="/loyalty"
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-text-secondary transition-colors hover:bg-bg-elevated hover:text-white"
                >
                  <Sparkles className="size-4" />
                  Loyalty
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium text-danger transition-colors hover:bg-danger/10"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </nav>
            </div>
          </aside>

          <section
            className={cn(
              "min-w-0 max-w-5xl",
              showContentOnMobile ? "block" : "hidden md:block",
            )}
          >
            {children}
          </section>
        </div>
      </main>
    </div>
  );
}

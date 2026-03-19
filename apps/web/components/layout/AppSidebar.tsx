"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useNavSection } from "@/lib/NavSectionContext";

const SIDEBAR_EXPANDED_KEY = "seatly-sidebar-expanded";

/** Badge counts per section - wire to real data later. Operations: overdue tables, Guests: high no-show risk, Business: metrics needing attention. */
function getSectionBadgeCount(sectionLabel: string): number {
  switch (sectionLabel) {
    case "OPERATIONS":
      return 0;
    case "GUESTS":
      return 0;
    case "BUSINESS":
      return 0;
    default:
      return 0;
  }
}

function formatSectionLabel(label: string): string {
  return label
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export function AppSidebar() {
  const { user } = useAuth();
  const { visibleSections, selectedSectionLabel, setSelectedSectionLabel } =
    useNavSection();

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_EXPANDED_KEY);
      setExpanded(stored === "true");
    } catch {
      setExpanded(false);
    }
  }, []);

  const toggleExpanded = () => {
    setExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_EXPANDED_KEY, String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  if (!user) return null;

  const initials = user.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <aside
      className={`flex flex-col border-r border-sidebar-border bg-sidebar-bg backdrop-blur-app-nav transition-all duration-400 ease-out ${
        expanded ? "w-sidebar-expanded-width" : "w-sidebar-width"
      }`}
    >
      <div
        className={`flex flex-shrink-0 items-center border-b border-sidebar-border transition-all duration-400 ${
          expanded
            ? "h-14 justify-between gap-md px-lg"
            : "flex-col justify-center gap-5 px-md py-xl"
        }`}
      >
        <span className="text-xl font-bold tracking-tight-hero text-gold">
          S
        </span>
        {expanded && (
          <span className="flex-1 truncate text-xs font-medium uppercase tracking-widest text-text-muted-on-dark">
            Seatly
          </span>
        )}
        <button
          type="button"
          onClick={toggleExpanded}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gold/90 transition-colors duration-200 hover:bg-gold/10 hover:text-gold"
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
        >
          {expanded ? (
            <PanelLeftClose className="h-5 w-5" strokeWidth={1.5} />
          ) : (
            <PanelLeft className="h-5 w-5" strokeWidth={1.5} />
          )}
        </button>
      </div>

      <nav
        className={`flex flex-1 flex-col overflow-y-auto p-md transition-all duration-400 ${
          expanded ? "items-stretch gap-xs" : "items-center gap-xs"
        }`}
      >
        {visibleSections.map((section) => {
          const isActive = selectedSectionLabel === section.label;
          const Icon = section.icon;
          const firstHref = section.items[0]?.href;
          const badgeCount = getSectionBadgeCount(section.label);

          return (
            <Link
              key={section.label}
              href={firstHref ?? "/"}
              onClick={() => setSelectedSectionLabel(section.label)}
              className={`relative flex items-center gap-md rounded-lg transition-all duration-400 ease-out hover:bg-gold/10 hover:text-gold ${
                expanded ? "h-11 px-md" : "h-11 w-11 flex-shrink-0 justify-center"
              } ${
                isActive
                  ? "border-l-2 border-gold bg-gold/10 text-gold"
                  : "text-white/35 hover:text-white/60"
              }`}
              aria-label={section.label}
              title={section.label}
            >
              <Icon className="h-6 w-6 shrink-0" strokeWidth={1.5} />
              {expanded && (
                <span className="truncate text-sm font-medium">
                  {formatSectionLabel(section.label)}
                </span>
              )}
              {badgeCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-semibold text-text-on-gold">
                  {badgeCount > 99 ? "99+" : badgeCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-shrink-0 flex-col items-center gap-xs border-t border-sidebar-border p-md">
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.fullName}
            className="h-8 w-8 rounded-full object-cover"
            title={user.fullName}
          />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] text-xs font-medium text-text-muted-on-dark"
            title={user.fullName}
          >
            {initials || "?"}
          </div>
        )}
      </div>
    </aside>
  );
}

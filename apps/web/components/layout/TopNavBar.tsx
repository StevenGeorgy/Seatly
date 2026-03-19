"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/AuthContext";
import { useRestaurant } from "@/lib/RestaurantContext";
import { useNavSection } from "@/lib/NavSectionContext";

export function TopNavBar() {
  const { user, logout } = useAuth();
  const { restaurantName } = useRestaurant();
  const { visibleSections, selectedSectionLabel, activeHref } = useNavSection();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  if (!user) return null;

  const selectedSection = visibleSections.find(
    (s) => s.label === selectedSectionLabel
  ) ?? visibleSections[0];
  const SectionIcon = selectedSection?.icon;

  const initials = user.fullName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="flex h-top-nav-height shrink-0 items-center justify-between overflow-visible border-b border-top-nav-border-bottom bg-top-nav-bg px-xl py-3 backdrop-blur-app-nav">
      <div className="flex min-w-0 flex-1 items-center gap-2xl">
        <span className="truncate text-base font-medium uppercase tracking-widest text-text-muted-on-dark">
          {restaurantName ?? "Restaurant"}
        </span>

        <nav className="flex items-center gap-xl">
          {selectedSection?.items.map((item) => {
            const isActive = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                className={`flex items-center gap-md px-5 py-4 text-lg font-medium transition-all duration-200 ease-out rounded-md ${
                  isActive
                    ? "border-b-2 border-gold text-gold"
                    : "text-white/40 hover:bg-white/5 hover:text-white/70"
                }`}
              >
                {SectionIcon && (
                  <SectionIcon
                    className="h-6 w-6 shrink-0"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                )}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="relative flex h-full flex-shrink-0 items-center" ref={menuRef}>
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex h-full items-center gap-lg rounded-lg px-lg py-4 text-base transition-colors duration-200 hover:bg-white/5"
          aria-expanded={userMenuOpen}
          aria-haspopup="true"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/20 text-base font-semibold text-gold">
            {initials || "?"}
          </div>
          <div className="hidden text-left sm:block">
            <p className="text-lg font-medium text-text-on-dark">{user.fullName}</p>
            <p className="text-sm text-text-muted-on-dark">{user.role}</p>
          </div>
          <ChevronDown
            className={`h-5 w-5 text-text-muted-on-dark transition-transform duration-200 ${
              userMenuOpen ? "rotate-180" : ""
            }`}
            strokeWidth={1.5}
          />
        </button>

        {userMenuOpen && (
          <div
            className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-card-border bg-card-bg py-1 shadow-lg"
            role="menu"
          >
            <div className="border-b border-card-border px-lg py-4">
              <p className="text-base font-medium text-text-on-dark">{user.fullName}</p>
              <p className="mt-0.5">
                <span className="rounded-full border border-gold/50 bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
                  {user.role}
                </span>
              </p>
            </div>
            <div className="py-1">
              <button
                type="button"
                onClick={() => {
                  setUserMenuOpen(false);
                  void logout();
                }}
                className="flex w-full items-center gap-md px-lg py-3 text-base text-text-muted-on-dark transition-colors duration-200 hover:bg-row-hover-bg hover:text-text-on-dark"
                role="menuitem"
              >
                <LogOut className="h-4 w-4" strokeWidth={1.5} />
                Log out
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

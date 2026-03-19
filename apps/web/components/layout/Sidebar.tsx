"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { NAV_SECTIONS, getActiveNavHref } from "@/lib/nav";

export function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  const visibleSections = useMemo(() => {
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(user.role)),
    })).filter((s) => s.items.length > 0);
  }, [user.role]);

  const visibleHrefs = useMemo(
    () => visibleSections.flatMap((section) => section.items.map((item) => item.href)),
    [visibleSections]
  );

  const activeHref = useMemo(
    () => getActiveNavHref(pathname, visibleHrefs) ?? null,
    [pathname, visibleHrefs]
  );

  const routeActiveSection = useMemo(() => {
    if (!activeHref) return visibleSections[0]?.label ?? null;
    return (
      visibleSections.find((s) => s.items.some((i) => i.href === activeHref))
        ?.label ?? visibleSections[0]?.label ?? null
    );
  }, [activeHref, visibleSections]);

  const [selectedSectionLabel, setSelectedSectionLabel] = useState<string | null>(
    routeActiveSection
  );

  // Keep the rail in sync when navigation changes route.
  useEffect(() => {
    setSelectedSectionLabel(routeActiveSection);
  }, [routeActiveSection]);

  const selectedSection = useMemo(() => {
    if (!selectedSectionLabel) return visibleSections[0] ?? null;
    return (
      visibleSections.find((s) => s.label === selectedSectionLabel) ??
      visibleSections[0] ??
      null
    );
  }, [selectedSectionLabel, visibleSections]);

  return (
    <aside className="flex min-w-[320px] flex-col border-r border-gold-glass bg-gold-glass backdrop-blur-xl">
      <div className="border-b border-gold-glass px-xl py-lg">
        <span className="text-lg font-semibold tracking-tight-hero text-gold">
          Seatly
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left rail: section selection (only one highlighted). */}
        <nav className="flex w-[140px] flex-col gap-xs overflow-y-auto p-md">
          {visibleSections.map((section) => {
            const isActiveSection = selectedSection?.label === section.label;

            return (
              <button
                key={section.label}
                type="button"
                onClick={() => setSelectedSectionLabel(section.label)}
                className={`flex items-center justify-center rounded-md border-l-2 px-md py-sm text-sm font-medium outline-none transition-all duration-400 ease-out ${
                  isActiveSection
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-transparent text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark active:scale-[0.98]"
                }`}
                aria-current={isActiveSection ? "page" : undefined}
              >
                {section.label}
              </button>
            );
          })}
        </nav>

        {/* Right panel: subsections for the active rail section. */}
        <nav className="flex flex-1 flex-col overflow-y-auto p-md">
          {selectedSection ? (
            <>
              <p className="mb-xs px-md text-xs font-medium uppercase tracking-widest text-gold-muted">
                {selectedSection.label}
              </p>
              <div className="flex flex-col gap-xs">
                {selectedSection.items.map((item) => {
                  const isActive = activeHref === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch
                      className={`rounded-md border-l-2 px-md py-sm text-sm font-medium outline-none transition-all duration-400 ease-out ${
                        isActive
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-transparent text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark active:scale-[0.98]"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </>
          ) : null}
        </nav>
      </div>
    </aside>
  );
}

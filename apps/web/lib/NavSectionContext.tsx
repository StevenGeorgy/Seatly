"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { NAV_SECTIONS, getActiveNavHref } from "@/lib/nav";
import { useAuth } from "@/lib/auth/AuthContext";

interface NavSectionContextValue {
  selectedSectionLabel: string | null;
  setSelectedSectionLabel: (label: string | null) => void;
  visibleSections: typeof NAV_SECTIONS;
  activeHref: string | null;
}

const NavSectionContext = createContext<NavSectionContextValue | null>(null);

export function NavSectionProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();

  const visibleSections = useMemo(() => {
    if (!user) return [];
    return NAV_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(user.role)),
    })).filter((s) => s.items.length > 0);
  }, [user?.role]);

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

  useEffect(() => {
    setSelectedSectionLabel(routeActiveSection);
  }, [routeActiveSection]);

  const value = useMemo(
    () => ({
      selectedSectionLabel,
      setSelectedSectionLabel,
      visibleSections,
      activeHref,
    }),
    [selectedSectionLabel, visibleSections, activeHref]
  );

  return (
    <NavSectionContext.Provider value={value}>{children}</NavSectionContext.Provider>
  );
}

export function useNavSection() {
  const ctx = useContext(NavSectionContext);
  if (!ctx) {
    throw new Error("useNavSection must be used within NavSectionProvider");
  }
  return ctx;
}

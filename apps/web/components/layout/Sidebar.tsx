"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { NAV_SECTIONS } from "@/lib/nav";

export function Sidebar() {
  const { user } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  return (
    <aside className="flex min-w-[220px] flex-col border-r border-gold-glass bg-gold-glass backdrop-blur-xl">
      <div className="border-b border-gold-glass px-xl py-lg">
        <span className="text-lg font-semibold tracking-tight-hero text-gold">
          Seatly
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-xs overflow-y-auto p-md">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) =>
            item.roles.includes(user.role)
          );
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.label} className="mb-lg">
              <p className="mb-xs px-md text-xs font-medium uppercase tracking-widest text-gold-muted">
                {section.label}
              </p>
              <div className="flex flex-col gap-xs">
                {visibleItems.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + "/");
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`rounded-md border-l-2 px-md py-sm text-sm font-medium transition-colors ${
                        isActive
                          ? "border-gold bg-gold/10 text-gold"
                          : "border-transparent text-text-muted-on-dark hover:bg-gold/5 hover:text-text-on-dark"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

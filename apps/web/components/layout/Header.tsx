"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import Link from "next/link";

export function Header() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border-dark bg-surface-dark-elevated px-lg">
      <Link href="/" className="text-xl font-bold text-text-on-dark">
        Seatly
      </Link>
      <div className="flex items-center gap-lg">
        <span className="rounded-md bg-gold/10 px-sm py-xs text-xs font-medium text-gold">
          {user.role}
        </span>
        <span className="text-sm text-text-muted-on-dark">{user.fullName}</span>
        <button
          type="button"
          onClick={logout}
          className="text-sm text-text-muted-on-dark hover:text-text-on-dark"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

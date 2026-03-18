"use client";

import { useAuth } from "@/lib/auth/AuthContext";
import Link from "next/link";

export function Header() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-lg">
      <Link href="/" className="text-xl font-bold text-text">
        Seatly
      </Link>
      <div className="flex items-center gap-lg">
        <span className="rounded-md bg-surface-muted px-sm py-xs text-xs font-medium text-text-muted">
          {user.role}
        </span>
        <span className="text-sm text-text-muted">{user.fullName}</span>
        <button
          type="button"
          onClick={logout}
          className="text-sm text-text-muted hover:text-text"
        >
          Log out
        </button>
      </div>
    </header>
  );
}

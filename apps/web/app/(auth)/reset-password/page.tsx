"use client";

import { useState } from "react";
import Link from "next/link";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Placeholder — will use Supabase Auth updateUser in Phase 2
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-xl shadow-md">
      <h1 className="mb-lg text-2xl font-bold text-text">Set new password</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
        <div>
          <label htmlFor="password" className="mb-xs block text-sm font-medium text-text">
            New password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-md border border-border px-md py-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-xs block text-sm font-medium text-text">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="••••••••"
            className="w-full rounded-md border border-border px-md py-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-lg py-sm font-medium text-white hover:bg-primary-hover"
        >
          Reset password
        </button>
      </form>
      <p className="mt-lg text-center text-sm text-text-muted">
        <Link href="/login" className="hover:text-primary">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

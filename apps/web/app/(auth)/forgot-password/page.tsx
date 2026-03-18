"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Placeholder — will use Supabase Auth resetPasswordForEmail in Phase 2
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-xl shadow-md">
      <h1 className="mb-lg text-2xl font-bold text-text">Reset password</h1>
      <p className="mb-lg text-sm text-text-muted">
        Enter your email and we&apos;ll send you a reset link.
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
        <div>
          <label htmlFor="email" className="mb-xs block text-sm font-medium text-text">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner@restaurant.com"
            className="w-full rounded-md border border-border px-md py-sm text-text focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-lg py-sm font-medium text-white hover:bg-primary-hover"
        >
          Send reset link
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

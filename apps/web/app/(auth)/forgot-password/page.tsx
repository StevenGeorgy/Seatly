"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const canSubmit = email.trim().length > 0 && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error: resetError } =
        await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });

      if (resetError) {
        setError(resetError.message);
        setIsSubmitting(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (success) {
    return (
      <div className="relative w-full max-w-[400px] px-xl">
        <div className="relative overflow-hidden rounded-2xl border border-auth-card bg-auth-card p-xl backdrop-blur-[20px]">
          <div className="flex flex-col items-center text-center">
            <CheckIcon className="h-16 w-16 text-gold" />
            <h2 className="mt-xl text-xl font-semibold text-text-on-dark">
              Email sent
            </h2>
            <p className="mt-md text-sm leading-relaxed text-text-muted-on-dark">
              Check your inbox for a reset link. Check your spam folder if you
              do not see it within a few minutes.
            </p>
            <Link
              href="/login"
              className="mt-xl text-sm text-gold-muted transition-colors duration-200 hover:text-gold"
            >
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full max-w-[400px] px-xl">
      <div className="relative overflow-hidden rounded-2xl border border-auth-card bg-auth-card p-xl backdrop-blur-[20px]">
        <div className="mb-xl text-center">
          <span className="text-2xl font-bold tracking-tight text-text-on-dark">
            Seatly
          </span>
          <div className="mx-auto mt-md h-0.5 w-10 bg-gold" />
        </div>

        <h2 className="text-xl font-semibold text-text-on-dark">
          Reset your password
        </h2>
        <p className="mt-xs text-sm text-text-muted-on-dark">
          Enter your email and we will send you a reset link
        </p>

        <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-lg">
          <div>
            <label
              htmlFor="email"
              className="mb-xs block text-xs font-medium uppercase tracking-widest text-gold"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@restaurant.com"
              autoComplete="email"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-auth-input bg-auth-input px-md py-sm text-text-on-dark placeholder-text-muted-on-dark transition-colors duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-auth-focus disabled:opacity-50"
            />
          </div>

          {error && (
            <div className="rounded-lg border-l-4 border-error bg-error-muted px-md py-sm text-sm text-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="flex w-full items-center justify-center gap-sm rounded-lg bg-gold px-2xl py-lg font-semibold text-text-on-gold transition-all duration-200 hover:bg-gold-muted disabled:opacity-50 disabled:hover:bg-gold"
          >
            {isSubmitting ? (
              <>
                <div
                  className="h-lg w-lg animate-spin rounded-full border-2 border-text-on-gold border-t-transparent"
                  aria-hidden
                />
                Sending...
              </>
            ) : (
              "Send Reset Link"
            )}
          </button>
        </form>

        <p className="mt-lg text-center text-sm text-text-muted-on-dark">
          <Link
            href="/login"
            className="text-gold-muted transition-colors duration-200 hover:text-gold"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default ForgotPasswordPage;

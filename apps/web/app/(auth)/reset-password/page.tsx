"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type PasswordStrength = "weak" | "good" | "strong";

function getPasswordStrength(password: string): PasswordStrength {
  if (!password) return "weak";
  const hasMinLength = password.length >= 8;
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);

  if (!hasMinLength || !hasNumber) return "weak";
  if (hasSymbol) return "strong";
  return "good";
}

function isValidPassword(password: string): boolean {
  return getPasswordStrength(password) !== "weak";
}

function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasValidToken, setHasValidToken] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const hasRecoveryToken =
      hash.includes("type=recovery") || hash.includes("access_token");
    setHasValidToken(hasRecoveryToken);
  }, []);

  const passwordStrength = getPasswordStrength(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;
  const canSubmit =
    isValidPassword(password) &&
    passwordsMatch &&
    !isSubmitting &&
    hasValidToken;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        if (
          updateError.message.includes("expired") ||
          updateError.message.includes("invalid")
        ) {
          setError("This reset link is invalid or has expired");
        } else {
          setError(updateError.message);
        }
        setIsSubmitting(false);
        return;
      }

      router.replace("/login?reset=success");
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  if (hasValidToken === null) {
    return (
      <div className="flex w-full max-w-[400px] items-center justify-center px-xl">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-gold border-t-transparent"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (!hasValidToken) {
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
            Invalid reset link
          </h2>
          <p className="mt-md text-sm text-text-muted-on-dark">
            This reset link is invalid or has expired
          </p>
          <Link
            href="/forgot-password"
            className="mt-xl inline-block text-sm text-gold-muted transition-colors duration-200 hover:text-gold"
          >
            Request a new reset link
          </Link>
        </div>
      </div>
    );
  }

  const strengthBarWidth =
    passwordStrength === "weak" ? "33%" : passwordStrength === "good" ? "66%" : "100%";
  const strengthBarColor =
    passwordStrength === "weak"
      ? "bg-error"
      : passwordStrength === "good"
        ? "bg-gold"
        : "bg-success";

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
          Set new password
        </h2>

        <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-lg">
          <div>
            <label
              htmlFor="password"
              className="mb-xs block text-xs font-medium uppercase tracking-widest text-gold"
            >
              New password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-auth-input bg-auth-input px-md py-sm text-text-on-dark placeholder-text-muted-on-dark transition-colors duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-auth-focus disabled:opacity-50"
            />
            {password.length > 0 && (
              <div className="mt-sm flex w-full items-center gap-md">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-dark-elevated">
                  <div
                    className={`h-full transition-all duration-200 ${strengthBarColor}`}
                    style={{ width: strengthBarWidth }}
                  />
                </div>
                <span
                  className={`text-xs font-medium ${
                    passwordStrength === "weak"
                      ? "text-error"
                      : passwordStrength === "good"
                        ? "text-gold"
                        : "text-success"
                  }`}
                >
                  {passwordStrength}
                </span>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-xs block text-xs font-medium uppercase tracking-widest text-gold"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-auth-input bg-auth-input px-md py-sm text-text-on-dark placeholder-text-muted-on-dark transition-colors duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-auth-focus disabled:opacity-50"
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="mt-xs text-xs text-error">Passwords do not match</p>
            )}
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
                Updating...
              </>
            ) : (
              "Update Password"
            )}
          </button>
        </form>

        <p className="mt-lg text-center text-sm text-text-muted-on-dark">
          <Link
            href="/forgot-password"
            className="text-gold-muted transition-colors duration-200 hover:text-gold"
          >
            Request a new reset link
          </Link>
        </p>
      </div>
    </div>
  );
}

export default ResetPasswordPage;

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { User, Role } from "@seatly/types";

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

function EyeIcon({ className }: { className?: string }) {
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
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
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
        d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.12 9.12l-2.29-2.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
      />
    </svg>
  );
}

function SignUpPage() {
  const [fullName, setFullName] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { setUserFromSession } = useAuth();
  const router = useRouter();

  const passwordStrength = getPasswordStrength(password);
  const canSubmit =
    fullName.trim().length > 0 &&
    restaurantName.trim().length > 0 &&
    email.trim().length > 0 &&
    isValidPassword(password) &&
    agreedToTerms &&
    !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/signup-restaurant-owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          restaurant_name: restaurantName.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        profile?: {
          id: string;
          email?: string;
          fullName?: string;
          full_name?: string;
          role?: string;
          restaurantId?: string | null;
          restaurant_id?: string | null;
          avatarUrl?: string | null;
          avatar_url?: string | null;
        };
      };

      const err = data?.error;
      if (err || !res.ok) {
        const msg = typeof err === "string" ? err : "";
        if (
          res.status === 503 ||
          msg.toLowerCase().includes("not configured") ||
          msg.toLowerCase().includes("missing env")
        ) {
          setError(msg || "Check .env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then restart dev.");
        } else if (
          msg.toLowerCase().includes("already") ||
          msg.toLowerCase().includes("exists") ||
          res.status === 409
        ) {
          setError("Email already in use");
        } else if (msg.toLowerCase().includes("password")) {
          setError("Password must be at least 8 characters and include a number");
        } else {
          setError(msg || "Something went wrong");
        }
        setIsSubmitting(false);
        return;
      }

      const supabase = createClient();
      const profileFromFn = data?.profile;
      if (!profileFromFn || !profileFromFn.id) {
        setError("Account created but profile missing. Please sign in manually.");
        setIsSubmitting(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signInError) {
        setError("Account created. Please sign in manually.");
        setIsSubmitting(false);
        return;
      }

      const profile: User = {
        id: profileFromFn.id,
        email: profileFromFn.email ?? "",
        fullName: profileFromFn.fullName ?? profileFromFn.full_name ?? "",
        role: (profileFromFn.role ?? "owner") as Role,
        restaurantId: profileFromFn.restaurantId ?? profileFromFn.restaurant_id ?? null,
        avatarUrl: profileFromFn.avatarUrl ?? profileFromFn.avatar_url ?? null,
      };

      setUserFromSession(profile);
      router.push("/onboarding");
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
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
    <div className="relative w-full max-w-[480px] px-xl">
      <div className="relative overflow-hidden rounded-2xl border border-auth-card bg-auth-card p-xl backdrop-blur-[20px]">
        <div className="mb-xl text-center">
          <span className="text-2xl font-bold tracking-tight text-text-on-dark">
            Seatly
          </span>
          <div className="mx-auto mt-md h-0.5 w-10 bg-gold" />
        </div>

        <p className="mb-xs text-xs font-medium uppercase tracking-widest text-gold-muted">
          Step 1 of 2
        </p>
        <h2 className="text-xl font-semibold text-text-on-dark">
          Create your account
        </h2>
        <p className="mt-xs text-sm text-text-muted-on-dark">
          Set up your restaurant on Seatly
        </p>

        <form onSubmit={handleSubmit} className="mt-xl flex flex-col gap-lg">
          <div>
            <label
              htmlFor="fullName"
              className="mb-xs block text-xs font-medium uppercase tracking-widest text-gold"
            >
              Full name
            </label>
            <input
              id="fullName"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Smith"
              autoComplete="name"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-auth-input bg-auth-input px-md py-sm text-text-on-dark placeholder-text-muted-on-dark transition-colors duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-auth-focus disabled:opacity-50"
            />
          </div>

          <div>
            <label
              htmlFor="restaurantName"
              className="mb-xs block text-xs font-medium uppercase tracking-widest text-gold"
            >
              Restaurant name
            </label>
            <input
              id="restaurantName"
              type="text"
              value={restaurantName}
              onChange={(e) => setRestaurantName(e.target.value)}
              placeholder="My Restaurant"
              autoComplete="organization"
              disabled={isSubmitting}
              className="w-full rounded-lg border border-auth-input bg-auth-input px-md py-sm text-text-on-dark placeholder-text-muted-on-dark transition-colors duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-auth-focus disabled:opacity-50"
            />
          </div>

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

          <div>
            <label
              htmlFor="password"
              className="mb-xs block text-xs font-medium uppercase tracking-widest text-gold"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                disabled={isSubmitting}
                className="w-full rounded-lg border border-auth-input bg-auth-input px-md py-sm pr-3xl text-text-on-dark placeholder-text-muted-on-dark transition-colors duration-200 focus:border-gold focus:outline-none focus:ring-2 focus:ring-auth-focus disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-md top-1/2 -translate-y-1/2 text-text-muted-on-dark transition-colors duration-200 hover:text-gold"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOffIcon className="h-xl w-xl" />
                ) : (
                  <EyeIcon className="h-xl w-xl" />
                )}
              </button>
            </div>
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

          <label className="flex cursor-pointer items-start gap-md">
            <input
              type="checkbox"
              checked={agreedToTerms}
              onChange={(e) => setAgreedToTerms(e.target.checked)}
              disabled={isSubmitting}
              className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border border-auth-input bg-auth-input accent-gold transition-colors duration-200 focus:ring-2 focus:ring-auth-focus focus:ring-offset-0 focus:ring-offset-transparent disabled:cursor-not-allowed"
            />
            <span className="text-sm text-text-muted-on-dark">
              I agree to the{" "}
              <Link href="#" className="text-gold-muted hover:text-gold">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="#" className="text-gold-muted hover:text-gold">
                Privacy Policy
              </Link>
            </span>
          </label>

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
                Creating account...
              </>
            ) : (
              "Get Started"
            )}
          </button>
        </form>

        <p className="mt-lg text-center text-sm text-text-muted-on-dark">
          <Link
            href="/login"
            className="text-gold-muted transition-colors duration-200 hover:text-gold"
          >
            Already have an account? Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default SignUpPage;

"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { User, Role } from "@seatly/types";

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

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { setUserFromSession, getRoleHome } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("reset") === "success") {
      setSuccessMessage("Password updated. You can now sign in.");
    }
  }, [searchParams]);

  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const supabase = createClient();
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          setError("Invalid email or password");
        } else if (signInError.message.includes("Email not confirmed")) {
          setError("Please verify your email before signing in");
        } else {
          setError(signInError.message);
        }
        setIsSubmitting(false);
        return;
      }

      if (!data.user) {
        setError("Sign in failed. Please try again.");
        setIsSubmitting(false);
        return;
      }

      const { data: profileRow, error: profileError } = await supabase
        .from("user_profiles")
        .select("id, email, full_name, role, restaurant_id, avatar_url")
        .eq("auth_user_id", data.user.id)
        .single();

      if (profileError || !profileRow) {
        setError("Profile not found. Please contact support.");
        await supabase.auth.signOut();
        setIsSubmitting(false);
        return;
      }

      const profile: User = {
        id: profileRow.id,
        email: profileRow.email ?? "",
        fullName: profileRow.full_name ?? "",
        role: profileRow.role as Role,
        restaurantId: profileRow.restaurant_id,
        avatarUrl: profileRow.avatar_url ?? null,
      };

      setUserFromSession(profile);
      router.replace(getRoleHome(profile.role));
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative w-full max-w-[420px] px-xl">
      {/* Subtle animated gold gradient behind card */}
      <div
        className="pointer-events-none absolute -inset-20 rounded-full bg-gold/5 opacity-60 blur-3xl"
        style={{
          animation: "pulse 4s ease-in-out infinite",
        }}
      />
      <div
        className="pointer-events-none absolute -inset-10 rounded-full bg-gold/3 opacity-40 blur-2xl"
        style={{
          animation: "pulse 5s ease-in-out infinite 0.5s",
        }}
      />

      <div className="relative overflow-hidden rounded-2xl border border-auth-card bg-auth-card p-xl backdrop-blur-[20px]">
        <div className="mb-xl text-center">
          <span className="text-2xl font-bold tracking-tight text-text-on-dark">
            Seatly
          </span>
          <div className="mx-auto mt-md h-0.5 w-10 bg-gold" />
        </div>

        <h2 className="text-xl font-semibold text-text-on-dark">Welcome back</h2>
        <p className="mt-xs text-sm text-text-muted-on-dark">
          Sign in to your restaurant
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
                autoComplete="current-password"
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
          </div>

          {successMessage && (
            <div className="rounded-lg border-l-4 border-success bg-success-muted px-md py-sm text-sm text-success">
              {successMessage}
            </div>
          )}
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
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <div className="mt-lg flex flex-col items-center gap-sm text-center">
          <Link
            href="/forgot-password"
            className="text-sm text-gold-muted transition-colors duration-200 hover:text-gold"
          >
            Forgot password?
          </Link>
          <Link
            href="/signup"
            className="text-sm text-gold-muted transition-colors duration-200 hover:text-gold"
          >
            New restaurant? Get started
          </Link>
        </div>
      </div>
    </div>
  );
}

function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex w-full max-w-[420px] items-center justify-center px-xl">
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-gold border-t-transparent"
            aria-label="Loading"
          />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

export default LoginPage;

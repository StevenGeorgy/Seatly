"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth/AuthContext";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@seatly/types";

const ROLE_HOME: Record<Role, string> = {
  owner: "/dashboard",
  host: "/floor-plan",
  waiter: "/my-tables",
  kitchen: "/kitchen",
  admin: "/admin",
  customer: "/dashboard",
};

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.12 9.12l-2.29-2.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user, getRoleHome } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) {
      router.replace(getRoleHome(user.role));
    }
  }, [user, getRoleHome, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email");
      return;
    }
    if (!password) {
      setError("Please enter your password");
      return;
    }

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

      const { data: profile, error: profileError } = await supabase
        .from("user_profiles")
        .select("role")
        .eq("auth_user_id", data.user.id)
        .single();

      if (profileError || !profile) {
        setError("Profile not found. Please contact support.");
        await supabase.auth.signOut();
        setIsSubmitting(false);
        return;
      }

      const role = profile.role as Role;
      router.replace(ROLE_HOME[role] ?? "/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background-dark px-md">
      <div className="w-full max-w-md">
        <div className="rounded-lg border border-border-dark bg-surface-dark-elevated p-2xl shadow-gold-glow">
          <div className="mb-xl text-center">
            <h1 className="text-3xl font-bold tracking-tight text-text-on-dark">Seatly</h1>
            <div className="mx-auto mt-md h-px w-16 bg-gold" />
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-lg">
            {error && (
              <div className="rounded-md border border-error bg-error-muted px-md py-sm text-sm text-error">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="mb-xs block text-sm font-medium text-text-muted-on-dark">
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
                className="w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
              />
            </div>

            <div>
              <label htmlFor="password" className="mb-xs block text-sm font-medium text-text-muted-on-dark">
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
                  className="w-full rounded-md border border-border-dark bg-surface-dark px-md py-sm pr-10 text-text-on-dark placeholder-text-muted-on-dark focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-md top-1/2 -translate-y-1/2 text-text-muted-on-dark hover:text-gold-muted"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOffIcon className="h-5 w-5" />
                  ) : (
                    <EyeIcon className="h-5 w-5" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center justify-center gap-sm rounded-md bg-gold px-lg py-sm font-semibold text-text-on-gold hover:bg-gold-muted disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <div
                    className="h-4 w-4 animate-spin rounded-full border-2 border-text-on-gold border-t-transparent"
                    aria-hidden
                  />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="mt-lg text-center text-sm text-text-muted-on-dark">
            <Link href="/forgot-password" className="text-gold-muted hover:text-gold">
              Forgot password?
            </Link>
            {" · "}
            <Link href="/signup" className="text-gold-muted hover:text-gold">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

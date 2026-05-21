import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolvePostLoginPath } from "@/lib/auth/post-login-redirect";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadUserContext } from "@/lib/supabase/load-user-context";
import { createRegisterSchema } from "@/lib/validation/auth-schemas";

function buildLoginTarget(from: string | undefined, email: string): string {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (email) params.set("email", email);
  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

function isExistingAccountError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already") && (
    normalized.includes("registered") ||
    normalized.includes("exists") ||
    normalized.includes("user")
  );
}

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);
  const params = new URLSearchParams(location.search);
  const from = params.get("from") ?? undefined;
  const invitedEmail = params.get("email")?.trim().toLowerCase() ?? "";
  const loginTarget = buildLoginTarget(from, invitedEmail);

  const schema = useMemo(() => createRegisterSchema(t), [t]);
  type FormValues = z.infer<typeof schema>;

  const [ageConfirmed, setAgeConfirmed] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: "",
      email: invitedEmail,
      password: "",
      confirmPassword: "",
    },
  });

  const recordAgeConsent = async (
    client: ReturnType<typeof getSupabaseBrowserClient>,
    authUserId: string,
  ) => {
    // The `age_consent_at` column lands in a follow-up migration. If it
    // doesn't exist yet, swallow the error so signup isn't blocked.
    try {
      await client
        .from("user_profiles")
        .update({ age_consent_at: new Date().toISOString() })
        .eq("auth_user_id", authUserId);
    } catch {
      // intentional no-op
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!ageConfirmed) {
      toast.error("Please confirm you meet the age requirement.");
      return;
    }
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const fullName = values.fullName.trim();
      const email = values.email.trim().toLowerCase();
      const { data, error } = await client.auth.signUp({
        email,
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback${
            from ? `?from=${encodeURIComponent(from)}` : ""
          }`,
          data: fullName ? { full_name: fullName } : undefined,
        },
      });

      if (error) {
        if (isExistingAccountError(error.message)) {
          toast.info(t("auth.errors.accountAlreadyExistsLogin"));
          navigate(buildLoginTarget(from, email), { replace: true });
          return;
        }
        toast.error(t("auth.errors.signUpFailed"));
        return;
      }

      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        toast.info(t("auth.errors.accountAlreadyExistsLogin"));
        navigate(buildLoginTarget(from, email), { replace: true });
        return;
      }

      if (data.session) {
        await recordAgeConsent(client, data.session.user.id);
        const ctx = await loadUserContext(client, data.session);
        if (!ctx.ok) {
          toast.error(
            t("auth.errors.loadProfileFailedDetail", { message: ctx.error.message }),
          );
          return;
        }
        navigate(resolvePostLoginPath(from, ctx), { replace: true });
        return;
      }

      toast.success(t("auth.register.checkEmail"));
    } finally {
      setSubmitting(false);
    }
  };

  const signUpWithProvider = async (provider: "google" | "apple") => {
    if (!ageConfirmed) {
      toast.error("Please confirm you meet the age requirement.");
      return;
    }
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback${
            from ? `?from=${encodeURIComponent(from)}` : ""
          }`,
        },
      });
      if (error) {
        toast.error(t("auth.errors.oauthFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const phoneTarget = from ? `/login/phone?from=${encodeURIComponent(from)}` : "/login/phone";
  const [showEmailForm, setShowEmailForm] = useState(false);

  return (
    <AuthPageLayout titleKey="auth.register.title">
      {/* Age / parental consent gate — required before any sign-up path. */}
      <label className="flex items-start gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={ageConfirmed}
          onChange={(e) => setAgeConfirmed(e.target.checked)}
          className="mt-0.5 size-4 cursor-pointer accent-gold"
          aria-label="Age confirmation"
        />
        <span>
          I confirm I am 18+ or have parental consent to make payments on
          Cenaiva. Users under 16 may not register. See{" "}
          <Link
            to="/terms#eligibility"
            className="text-gold underline-offset-2 hover:underline"
          >
            Terms §1
          </Link>
          .
        </span>
      </label>

      {/* Phase 2 (2026-05-15): providers first, email/password collapsed. */}
      <div className="space-y-3">
        <Button
          className="h-12 w-full bg-white text-base font-semibold text-black hover:bg-white/90"
          disabled={submitting || !ageConfirmed}
          type="button"
          onClick={() => void signUpWithProvider("apple")}
        >

          Continue with Apple
        </Button>
        <Button
          className="h-12 w-full"
          disabled={submitting || !ageConfirmed}
          type="button"
          variant="outline"
          onClick={() => void signUpWithProvider("google")}
        >
          {t("auth.register.google")}
        </Button>
        <Button
          asChild
          className="h-12 w-full"
          disabled={submitting || !ageConfirmed}
          type="button"
          variant="outline"
        >
          <Link
            to={phoneTarget}
            onClick={(e) => {
              if (!ageConfirmed) {
                e.preventDefault();
                toast.error("Please confirm you meet the age requirement.");
              }
            }}
          >
            Continue with phone number
          </Link>
        </Button>
      </div>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="border-border w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card text-muted-foreground px-2">or</span>
        </div>
      </div>

      {!showEmailForm ? (
        <p className="text-center text-sm">
          <button
            type="button"
            onClick={() => setShowEmailForm(true)}
            className="text-text-secondary underline-offset-4 hover:text-white hover:underline"
          >
            Sign up with email and password
          </button>
        </p>
      ) : (
      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="space-y-2">
          <Label htmlFor="register-name">{t("auth.fields.fullName.label")}</Label>
          <Input
            id="register-name"
            type="text"
            autoComplete="name"
            className="h-12 px-4 rounded-md"
            aria-invalid={errors.fullName ? true : undefined}
            {...register("fullName")}
          />
          {errors.fullName ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.fullName.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-email">{t("auth.fields.email.label")}</Label>
          <Input
            id="register-email"
            type="email"
            autoComplete="email"
            className="h-12 px-4 rounded-md"
            aria-invalid={errors.email ? true : undefined}
            {...register("email")}
          />
          {errors.email ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.email.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-password">{t("auth.fields.password.label")}</Label>
          <Input
            id="register-password"
            type="password"
            autoComplete="new-password"
            className="h-12 px-4 rounded-md"
            aria-invalid={errors.password ? true : undefined}
            {...register("password")}
          />
          {errors.password ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.password.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="register-confirm">{t("auth.fields.confirmPassword.label")}</Label>
          <Input
            id="register-confirm"
            type="password"
            autoComplete="new-password"
            className="h-12 px-4 rounded-md"
            aria-invalid={errors.confirmPassword ? true : undefined}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword ? (
            <p className="text-destructive text-sm" role="alert">
              {errors.confirmPassword.message}
            </p>
          ) : null}
        </div>
        <Button
          className="w-full"
          disabled={submitting || !ageConfirmed}
          type="submit"
        >
          {t("auth.register.submit")}
        </Button>
      </form>
      )}

      <p className="text-muted-foreground text-center text-sm">
        {t("auth.register.hasAccount")}{" "}
        <Link
          className="text-primary underline-offset-4 hover:underline"
          to={loginTarget}
        >
          {t("auth.register.loginLink")}
        </Link>
      </p>
    </AuthPageLayout>
  );
}

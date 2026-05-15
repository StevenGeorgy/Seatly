import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInErrorTranslationKey } from "@/lib/auth/map-sign-in-error";
import { resolvePostLoginPath } from "@/lib/auth/post-login-redirect";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadUserContext } from "@/lib/supabase/load-user-context";
import { createLoginSchema } from "@/lib/validation/auth-schemas";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const [submitting, setSubmitting] = useState(false);
  const invitedEmail = params.get("email")?.trim().toLowerCase() ?? "";

  const schema = useMemo(() => createLoginSchema(t), [t]);
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: invitedEmail, password: "" },
  });

  const from = (location.state as { from?: string } | null)?.from ?? params.get("from") ?? undefined;

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const { data, error } = await client.auth.signInWithPassword({
        email: values.email.trim(),
        password: values.password,
      });

      if (error) {
        toast.error(t(signInErrorTranslationKey(error)));
        return;
      }

      if (!data.session) {
        toast.info(t("auth.login.confirmEmail"));
        return;
      }

      const ctx = await loadUserContext(client, data.session);
      if (!ctx.ok) {
        toast.error(
          t("auth.errors.loadProfileFailedDetail", { message: ctx.error.message }),
        );
        return;
      }

      const next = resolvePostLoginPath(from, ctx);
      navigate(next, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithProvider = async (provider: "google" | "apple") => {
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
    <AuthPageLayout titleKey="auth.login.title">
      {/* Phase 2 of diner auth overhaul (2026-05-15): providers first.
          Apple HIG requires Apple Sign-In to be prominent when offered;
          Google is the most-clicked desktop option; phone is universal.
          Email/password is intentionally de-emphasized as a small link. */}
      <div className="space-y-3">
        <Button
          className="h-12 w-full bg-white text-base font-semibold text-black hover:bg-white/90"
          disabled={submitting}
          type="button"
          onClick={() => void signInWithProvider("apple")}
        >

          Continue with Apple
        </Button>
        <Button
          className="h-12 w-full"
          disabled={submitting}
          type="button"
          variant="outline"
          onClick={() => void signInWithProvider("google")}
        >
          {t("auth.login.google")}
        </Button>
        <Button
          asChild
          className="h-12 w-full"
          disabled={submitting}
          type="button"
          variant="outline"
        >
          <Link to={phoneTarget}>Continue with phone number</Link>
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

      {showEmailForm ? (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="login-email">{t("auth.fields.email.label")}</Label>
            <Input
              id="login-email"
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
            <Label htmlFor="login-password">{t("auth.fields.password.label")}</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
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
          <Button className="w-full" disabled={submitting} type="submit">
            {t("auth.login.submit")}
          </Button>
        </form>
      ) : (
        <p className="text-center text-sm">
          <button
            type="button"
            onClick={() => setShowEmailForm(true)}
            className="text-text-secondary underline-offset-4 hover:text-white hover:underline"
          >
            Sign in with email and password
          </button>
        </p>
      )}

      <p className="text-muted-foreground text-center text-sm">
        <Link className="text-primary underline-offset-4 hover:underline" to="/forgot-password">
          {t("auth.login.forgotLink")}
        </Link>
      </p>
      <p className="text-muted-foreground text-center text-sm">
        {t("auth.login.noAccount")}{" "}
        <Link
          className="text-primary underline-offset-4 hover:underline"
          to={from ? `/register?from=${encodeURIComponent(from)}` : "/register"}
        >
          {t("auth.login.registerLink")}
        </Link>
      </p>
    </AuthPageLayout>
  );
}

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
import { createLoginSchema } from "@/lib/validation/auth-schemas";

export default function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [submitting, setSubmitting] = useState(false);

  const schema = useMemo(() => createLoginSchema(t), [t]);
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const from = (location.state as { from?: string } | null)?.from;

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
        toast.error(t("auth.errors.signInFailed"));
        return;
      }

      if (!data.session) {
        toast.info(t("auth.login.confirmEmail"));
        return;
      }

      const ctx = await loadUserContext(client, data.session);
      if (!ctx.ok) {
        toast.error(t("auth.errors.loadProfileFailed"));
        return;
      }

      const next = resolvePostLoginPath(from, ctx);
      navigate(next, { replace: true });
    } finally {
      setSubmitting(false);
    }
  };

  const signInWithGoogle = async () => {
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) {
        toast.error(t("auth.errors.oauthFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout titleKey="auth.login.title">
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

      <div className="space-y-4">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="border-border w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card text-muted-foreground px-2">{t("auth.login.divider")}</span>
          </div>
        </div>
        <Button
          className="w-full"
          disabled={submitting}
          type="button"
          variant="outline"
          onClick={() => void signInWithGoogle()}
        >
          {t("auth.login.google")}
        </Button>
      </div>

      <p className="text-muted-foreground text-center text-sm">
        <Link className="text-primary underline-offset-4 hover:underline" to="/forgot-password">
          {t("auth.login.forgotLink")}
        </Link>
      </p>
      <p className="text-muted-foreground text-center text-sm">
        {t("auth.login.noAccount")}{" "}
        <Link className="text-primary underline-offset-4 hover:underline" to="/register">
          {t("auth.login.registerLink")}
        </Link>
      </p>
    </AuthPageLayout>
  );
}

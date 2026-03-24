import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
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

export default function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const schema = useMemo(() => createRegisterSchema(t), [t]);
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const fullName = values.fullName.trim();
      const { data, error } = await client.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`,
          data: fullName ? { full_name: fullName } : undefined,
        },
      });

      if (error) {
        toast.error(t("auth.errors.signUpFailed"));
        return;
      }

      if (data.session) {
        const ctx = await loadUserContext(client, data.session);
        if (!ctx.ok) {
          toast.error(t("auth.errors.loadProfileFailed"));
          return;
        }
        navigate(resolvePostLoginPath(undefined, ctx), { replace: true });
        return;
      }

      toast.success(t("auth.register.checkEmail"));
    } finally {
      setSubmitting(false);
    }
  };

  const signUpWithGoogle = async () => {
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
    <AuthPageLayout titleKey="auth.register.title">
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
        <Button className="w-full" disabled={submitting} type="submit">
          {t("auth.register.submit")}
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
          onClick={() => void signUpWithGoogle()}
        >
          {t("auth.register.google")}
        </Button>
      </div>

      <p className="text-muted-foreground text-center text-sm">
        {t("auth.register.hasAccount")}{" "}
        <Link className="text-primary underline-offset-4 hover:underline" to="/login">
          {t("auth.register.loginLink")}
        </Link>
      </p>
    </AuthPageLayout>
  );
}

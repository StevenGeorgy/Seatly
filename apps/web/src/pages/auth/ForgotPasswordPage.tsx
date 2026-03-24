import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import type { z } from "zod";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { createForgotPasswordSchema } from "@/lib/validation/auth-schemas";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const schema = useMemo(() => createForgotPasswordSchema(t), [t]);
  type FormValues = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: FormValues) => {
    setSubmitting(true);
    try {
      if (!isSupabaseConfigured()) {
        toast.error(t("auth.errors.supabaseNotConfigured"));
        return;
      }
      const client = getSupabaseBrowserClient();
      const { error } = await client.auth.resetPasswordForEmail(values.email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast.error(t("auth.errors.resetEmailFailed"));
        return;
      }
      setSent(true);
      toast.success(t("auth.forgot.sent"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthPageLayout titleKey="auth.forgot.title">
      {sent ? (
        <p className="text-muted-foreground text-center text-sm">{t("auth.forgot.sentDetail")}</p>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          <p className="text-muted-foreground text-sm">{t("auth.forgot.description")}</p>
          <div className="space-y-2">
            <Label htmlFor="forgot-email">{t("auth.fields.email.label")}</Label>
            <Input
              id="forgot-email"
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
          <Button className="w-full" disabled={submitting} type="submit">
            {t("auth.forgot.submit")}
          </Button>
        </form>
      )}
      <p className="text-muted-foreground text-center text-sm">
        <Link className="text-primary underline-offset-4 hover:underline" to="/login">
          {t("auth.forgot.backToLogin")}
        </Link>
      </p>
    </AuthPageLayout>
  );
}

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { AuthPageLayout } from "@/components/auth/AuthPageLayout";
import { RouteFallback } from "@/components/routing/RouteFallback";
import { Button } from "@/components/ui/button";
import { resolvePostLoginPath } from "@/lib/auth/post-login-redirect";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { loadUserContext } from "@/lib/supabase/load-user-context";

export default function AuthCallbackPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!isSupabaseConfigured()) {
        setFailed(true);
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
      const client = getSupabaseBrowserClient();
      const {
        data: { session },
        error,
      } = await client.auth.getSession();
      if (error || !session) {
        setFailed(true);
        return;
      }
      const ctx = await loadUserContext(client, session);
      if (!ctx.ok) {
        setFailed(true);
        return;
      }
      navigate(resolvePostLoginPath(undefined, ctx), { replace: true });
    })();
  }, [navigate]);

  if (failed) {
    return (
      <AuthPageLayout titleKey="auth.oauth.title">
        <p className="text-muted-foreground text-center text-sm">{t("auth.oauth.error")}</p>
        <Button className="w-full" asChild>
          <Link to="/login">{t("auth.oauth.backLogin")}</Link>
        </Button>
      </AuthPageLayout>
    );
  }

  return <RouteFallback />;
}

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

type AuthPageLayoutProps = {
  titleKey: string;
  children: ReactNode;
};

export function AuthPageLayout({ titleKey, children }: AuthPageLayoutProps) {
  const { t } = useTranslation();

  return (
    <main className="bg-background text-foreground flex min-h-screen flex-col items-center justify-center p-4">
      <div className="border-border bg-card text-card-foreground w-full max-w-md space-y-6 rounded-lg border p-6">
        <h1 className="text-center text-xl font-semibold">{t(titleKey)}</h1>
        {children}
      </div>
    </main>
  );
}

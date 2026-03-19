import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  breadcrumb?: string[];
  /** Optional: when provided with label/subtitle, renders premium layout */
  label?: string;
  subtitle?: string;
  icon?: LucideIcon;
}

export function PageHeader({ title, breadcrumb, label, subtitle, icon: Icon }: PageHeaderProps) {
  const usePremium = Boolean(label || subtitle || Icon);

  return (
    <header className="mb-xl">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-sm text-sm text-text-muted-on-dark">
          {breadcrumb.join(" / ")}
        </nav>
      )}
      {usePremium ? (
        <div className="flex items-start gap-md">
          {Icon && (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-card bg-surface-dark">
              <Icon className="h-5 w-5 text-gold" strokeWidth={1.5} />
            </div>
          )}
          <div>
            {label && (
              <p className="text-xs font-medium uppercase tracking-widest text-gold">{label}</p>
            )}
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-text-on-dark">{title}</h1>
            {subtitle && (
              <p className="mt-xs text-sm text-text-muted-on-dark">{subtitle}</p>
            )}
            <div className="mt-md h-px w-12 rounded-full bg-gold/50" />
          </div>
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight text-text-on-dark">{title}</h1>
        </>
      )}
    </header>
  );
}

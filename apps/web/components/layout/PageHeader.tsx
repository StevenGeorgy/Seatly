interface PageHeaderProps {
  title: string;
  breadcrumb?: string[];
}

export function PageHeader({ title, breadcrumb }: PageHeaderProps) {
  return (
    <header className="mb-xl">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="mb-sm text-sm text-text-muted-on-dark">
          {breadcrumb.join(" / ")}
        </nav>
      )}
      <h1 className="text-2xl font-bold text-text-on-dark">{title}</h1>
    </header>
  );
}

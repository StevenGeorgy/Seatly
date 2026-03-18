interface EmptyStateProps {
  title: string;
  message?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface p-xl text-center">
      <p className="text-lg font-semibold text-text">{title}</p>
      {message && (
        <p className="mt-sm text-sm text-text-muted">{message}</p>
      )}
      {action && <div className="mt-lg">{action}</div>}
    </div>
  );
}

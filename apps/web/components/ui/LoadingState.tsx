export function LoadingState() {
  return (
    <div className="flex items-center justify-center p-2xl">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary"
        aria-label="Loading"
      />
    </div>
  );
}

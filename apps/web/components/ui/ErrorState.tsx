interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-error bg-error-muted p-xl text-center">
      <p className="text-base font-medium text-error">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-white hover:opacity-90"
        >
          Retry
        </button>
      )}
    </div>
  );
}

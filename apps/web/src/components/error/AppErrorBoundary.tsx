import { Component, type ErrorInfo, type ReactNode } from "react";

import { toUserFacingError } from "@/lib/errors";

type Props = { children: ReactNode };
type State = { friendlyMessage: string | null };

/**
 * Top-level error boundary. Catches render-time exceptions that escape every
 * page boundary. Routes the raw error through the friendly-error mapper so
 * the user sees plain language instead of a white screen with a stack trace.
 *
 * Page-level errors are caught by `PageErrorBoundary` inside DashboardLayout;
 * this is the final net for app-shell or provider crashes.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { friendlyMessage: null };

  static getDerivedStateFromError(error: unknown): State {
    const friendly = toUserFacingError(
      error,
      "Something went wrong. Refresh the page and try again.",
    );
    return { friendlyMessage: friendly.message };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    const friendly = toUserFacingError(error);
    console.error("[AppErrorBoundary]", friendly.code, friendly.technical, info.componentStack);
  }

  override render() {
    if (this.state.friendlyMessage) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <div className="max-w-md text-center">
            <h1 className="font-heading text-xl font-medium text-text-primary">
              We hit a snag
            </h1>
            <p className="mt-2 text-sm text-text-secondary">{this.state.friendlyMessage}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-6 inline-flex items-center justify-center rounded-lg border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-text-primary hover:bg-bg-elevated/80"
            >
              Refresh page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

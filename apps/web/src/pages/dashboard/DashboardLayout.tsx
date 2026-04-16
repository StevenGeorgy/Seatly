import { Component, Suspense, useEffect, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { useCenaiva } from "@/components/cenaiva/CenaivaProvider";
import { prefetchFloorPlanData } from "@/lib/floor-plan-data-cache";
import { cn } from "@/lib/utils";

// Syncs the dashboard's selected restaurant into CenaivaProvider and activates
// owner mode. Resets both when the dashboard unmounts.
function CenaivaDashboardSync() {
  const { selectedRestaurantId } = useRestaurantScope();
  const cenaiva = useCenaiva();

  useEffect(() => {
    if (!cenaiva) return;
    cenaiva.setMode("owner");
    cenaiva.setRestaurantId(selectedRestaurantId);
  }, [selectedRestaurantId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cenaiva) return;
    return () => {
      cenaiva.setMode("customer");
      cenaiva.setRestaurantId(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

// Catches render errors in individual pages so the shell stays visible
class PageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  override componentDidUpdate(prevProps: { children: ReactNode }) {
    // Reset when the page changes so the next route can try again
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }
  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-sm text-text-muted">Something went wrong loading this page.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// Skeleton that keeps the same height as the content area while a lazy chunk loads
function PageSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 w-48 rounded-xl bg-bg-elevated" />
      <div className="h-4 w-72 rounded-lg bg-bg-elevated" />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-2xl bg-bg-elevated" />
        ))}
      </div>
      <div className="h-64 rounded-2xl bg-bg-elevated" />
    </div>
  );
}

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const { selectedRestaurantId } = useRestaurantScope();

  /** Warm floor-plan data + JS chunk while the user is on other dashboard screens. */
  useEffect(() => {
    if (!selectedRestaurantId) return;
    void prefetchFloorPlanData(selectedRestaurantId);
    void import("@/pages/dashboard/FloorPlanPage");
  }, [selectedRestaurantId]);

  /** Floor plan needs full width/height of the main column (no max-width shell or page padding). */
  const isFloorPlanRoute = pathname.includes("/floor-plan");

  return (
    <div
      className={cn(
        "flex h-screen flex-col text-foreground sm:flex-row",
        isFloorPlanRoute ? "bg-bg-surface" : "bg-background",
      )}
    >
      <CenaivaDashboardSync />
      <DashboardSidebar />
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isFloorPlanRoute && "bg-bg-surface",
        )}
      >
        <DashboardTopBar />
        <main
          className={cn(
            "flex-1 min-h-0",
            isFloorPlanRoute
              ? "flex flex-col overflow-hidden bg-bg-surface"
              : "overflow-y-auto",
          )}
        >
          <div
            className={cn(
              isFloorPlanRoute
                ? "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-bg-surface"
                : "mx-auto max-w-7xl p-5 sm:p-6 lg:p-8",
            )}
          >
            {/* Suspense here keeps the shell (sidebar + topbar) visible while
                a lazy page chunk is loading — the top-level Suspense would
                replace the entire screen including the shell. */}
            <Suspense fallback={<PageSkeleton />}>
              <PageErrorBoundary key={pathname}>
                {isFloorPlanRoute ? (
                  /* Plain wrapper: skip AnimatePresence/motion so flex height reaches Konva reliably. */
                  <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-bg-surface">
                    <Outlet />
                  </div>
                ) : (
                  <AnimatePresence mode="sync">
                    <motion.div
                      key={pathname}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                      className="min-h-0 min-w-0 w-full"
                    >
                      <Outlet />
                    </motion.div>
                  </AnimatePresence>
                )}
              </PageErrorBoundary>
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}

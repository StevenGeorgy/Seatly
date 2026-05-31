import { Component, Suspense, useEffect, type ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { BillingStatusPill } from "@/components/billing/BillingStatusPill";
import { PaymentFailedBanner } from "@/components/dashboard/PaymentFailedBanner";
import { PaymentFailedModal } from "@/components/dashboard/PaymentFailedModal";
import { RestoreRestaurantBanner } from "@/components/dashboard/RestoreRestaurantBanner";
import { TestModeIndicator } from "@/components/dashboard/TestModeIndicator";
import { useRestaurantScope } from "@/contexts/restaurant-scope-context";
import { prefetchFloorPlanData } from "@/lib/floor-plan-data-cache";
import { cn } from "@/lib/utils";

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
  return <DashboardShell />;
}

function DashboardShell() {
  const { pathname } = useLocation();
  const { selectedRestaurantId, selectedRestaurant, refreshRestaurants } =
    useRestaurantScope();

  /** Warm floor-plan data + JS chunk while the user is on other dashboard screens. */
  useEffect(() => {
    if (!selectedRestaurantId) return;
    void prefetchFloorPlanData(selectedRestaurantId);
    void import("@/pages/dashboard/FloorPlanPage");
  }, [selectedRestaurantId]);

  /** Floor plan needs full width/height of the main column (no max-width shell or page padding). */
  const isFloorPlanRoute = pathname.includes("/floor-plan");

  // 2026-05-20 lifecycle banners — surfaced on every dashboard route.
  // Soft-deleted restaurants show a restore banner; payment-failed pauses
  // surface both a persistent banner and a one-per-session modal.
  const lifecycleBanners = selectedRestaurant ? (
    <>
      <RestoreRestaurantBanner
        restaurantId={selectedRestaurant.id}
        restaurantName={selectedRestaurant.name}
        deletedAt={selectedRestaurant.deleted_at}
        scheduledPurgeAt={selectedRestaurant.scheduled_purge_at}
        onRestored={refreshRestaurants}
      />
      <PaymentFailedBanner
        restaurantId={selectedRestaurant.id}
        restaurantName={selectedRestaurant.name}
        pausedReason={selectedRestaurant.paused_reason}
        deletedAt={selectedRestaurant.deleted_at}
        onUpdated={refreshRestaurants}
      />
      {/* Top-right billing status chip. Renders nothing when paused/deleted
          (PaymentFailedBanner and RestoreRestaurantBanner above handle those
          cases). Sits in the dashboard chrome so it's visible on every
          dashboard page. */}
      <div className="flex justify-end px-4 pt-2 sm:px-6">
        <BillingStatusPill
          subscriptionStatus={selectedRestaurant.subscription_status}
          trialEndsAt={selectedRestaurant.trial_ends_at}
          pausedReason={selectedRestaurant.paused_reason}
          cancelAtPeriodEnd={selectedRestaurant.subscription_cancel_at_period_end}
          pausedAt={selectedRestaurant.subscription_paused_at}
        />
      </div>
    </>
  ) : null;

  const lifecycleModal = selectedRestaurant ? (
    <PaymentFailedModal
      restaurantId={selectedRestaurant.id}
      pausedReason={selectedRestaurant.paused_reason}
      deletedAt={selectedRestaurant.deleted_at}
      onUpdated={refreshRestaurants}
    />
  ) : null;

  return (
    <div
      className={cn(
        "flex h-screen flex-col text-foreground sm:flex-row",
        "bg-background",
      )}
    >
      {lifecycleModal}
      <TestModeIndicator />
      <DashboardSidebar />
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          isFloorPlanRoute && "bg-background",
        )}
      >
        {lifecycleBanners}
        <main
          className={cn(
            "flex-1 min-h-0",
            isFloorPlanRoute
              ? "flex flex-col overflow-hidden bg-background"
              : "overflow-y-auto",
          )}
        >
          <div
            className={cn(
              isFloorPlanRoute
                ? "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
                // Extra top padding on mobile so page titles clear the fixed
                // hamburger button (top-left, sm:hidden). Reset to normal at sm+.
                : "w-full px-5 pb-5 pt-16 sm:p-6 lg:p-8",
            )}
          >
            {/* Suspense here keeps the shell (sidebar + topbar) visible while
                a lazy page chunk is loading — the top-level Suspense would
                replace the entire screen including the shell. */}
            <Suspense fallback={<PageSkeleton />}>
              <PageErrorBoundary key={pathname}>
                {isFloorPlanRoute ? (
                  /* Plain wrapper: skip AnimatePresence/motion so flex height reaches Konva reliably. */
                  <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden bg-background">
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

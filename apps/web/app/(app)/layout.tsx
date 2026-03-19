"use client";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { TopNavBar } from "@/components/layout/TopNavBar";
import { AssistantFloatingWidget } from "@/components/assistant/AssistantFloatingWidget";
import { RestaurantProvider } from "@/lib/RestaurantContext";
import { NavSectionProvider } from "@/lib/NavSectionContext";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <RestaurantProvider>
        <NavSectionProvider>
          <div className="flex min-h-screen bg-background-dark">
            <AppSidebar />
            <div className="relative flex flex-1 flex-col">
              <TopNavBar />
              <div className="pointer-events-none absolute inset-0 top-top-nav-height bg-gold-glow-section bg-no-repeat" />
              <main className="relative flex-1 px-page-padding py-page-padding">
          <div className="mx-auto max-w-content-max">{children}</div>
        </main>
            </div>
            <AssistantFloatingWidget />
          </div>
        </NavSectionProvider>
      </RestaurantProvider>
    </ProtectedRoute>
  );
}

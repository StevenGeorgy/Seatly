import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";

import { RestaurantScopeProvider } from "@/contexts/restaurant-scope-context";
import { DashboardRoleGuard } from "@/components/routing/DashboardRoleGuard";
import { GuestOnly } from "@/components/routing/GuestOnly";
import { RequireAuth } from "@/components/routing/RequireAuth";
import { RequireCustomer } from "@/components/routing/RequireCustomer";
import { RequireStaff } from "@/components/routing/RequireStaff";
import { RouteFallback } from "@/components/routing/RouteFallback";
import AboutPage from "@/pages/marketing/AboutPage";
import FeaturesPage from "@/pages/marketing/FeaturesPage";
import HomePage from "@/pages/marketing/HomePage";
import PricingPage from "@/pages/marketing/PricingPage";
import AccountPage from "@/pages/customer/AccountPage";
import DiscoverPage from "@/pages/customer/DiscoverPage";
import RestaurantPublicPage from "@/pages/customer/RestaurantPublicPage";
import AuthCallbackPage from "@/pages/auth/AuthCallbackPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import LoginPage from "@/pages/auth/LoginPage";
import RegisterPage from "@/pages/auth/RegisterPage";
import ResetPasswordPage from "@/pages/auth/ResetPasswordPage";
import SetupPage from "@/pages/auth/SetupPage";
import NotFoundPage from "@/pages/NotFoundPage";

const DashboardLayout = lazy(() => import("@/pages/dashboard/DashboardLayout"));
const OverviewPage = lazy(() => import("@/pages/dashboard/OverviewPage"));
const ReservationsPage = lazy(() => import("@/pages/dashboard/ReservationsPage"));
const FloorPlanPage = lazy(() => import("@/pages/dashboard/FloorPlanPage"));
const WaitlistPage = lazy(() => import("@/pages/dashboard/WaitlistPage"));
const OrdersPage = lazy(() => import("@/pages/dashboard/OrdersPage"));
const MenuPage = lazy(() => import("@/pages/dashboard/MenuPage"));
const StaffPage = lazy(() => import("@/pages/dashboard/StaffPage"));
const SchedulePage = lazy(() => import("@/pages/dashboard/SchedulePage"));
const CrmPage = lazy(() => import("@/pages/dashboard/CrmPage"));
const AnalyticsPage = lazy(() => import("@/pages/dashboard/AnalyticsPage"));
const ExpensesPage = lazy(() => import("@/pages/dashboard/ExpensesPage"));
const EventsPage = lazy(() => import("@/pages/dashboard/EventsPage"));
const ExportPage = lazy(() => import("@/pages/dashboard/ExportPage"));
const SettingsPage = lazy(() => import("@/pages/dashboard/SettingsPage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/about" element={<AboutPage />} />

        <Route
          path="/login"
          element={
            <GuestOnly>
              <LoginPage />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly>
              <RegisterPage />
            </GuestOnly>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <GuestOnly>
              <ForgotPasswordPage />
            </GuestOnly>
          }
        />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/setup"
          element={
            <RequireAuth>
              <SetupPage />
            </RequireAuth>
          }
        />

        <Route
          path="/discover"
          element={
            <RequireAuth>
              <RequireCustomer>
                <DiscoverPage />
              </RequireCustomer>
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <RequireCustomer>
                <AccountPage />
              </RequireCustomer>
            </RequireAuth>
          }
        />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <RequireStaff>
                <RestaurantScopeProvider>
                  <DashboardRoleGuard>
                    <DashboardLayout />
                  </DashboardRoleGuard>
                </RestaurantScopeProvider>
              </RequireStaff>
            </RequireAuth>
          }
        >
          <Route index element={<OverviewPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="floor-plan" element={<FloorPlanPage />} />
          <Route path="waitlist" element={<WaitlistPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="crm" element={<CrmPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="/:restaurantSlug" element={<RestaurantPublicPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

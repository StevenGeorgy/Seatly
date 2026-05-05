import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { RestaurantScopeProvider } from "@/contexts/restaurant-scope-context";
import { DashboardRoleGuard } from "@/components/routing/DashboardRoleGuard";
import { GuestOnly } from "@/components/routing/GuestOnly";
import { RequireAuth } from "@/components/routing/RequireAuth";
import { RequireCustomer } from "@/components/routing/RequireCustomer";
import { RequireStaff } from "@/components/routing/RequireStaff";
import { RouteFallback } from "@/components/routing/RouteFallback";

const HomePage = lazy(() => import("@/pages/marketing/HomePage"));
const FeaturesPage = lazy(() => import("@/pages/marketing/FeaturesPage"));
const HeyCenaivaPage = lazy(() => import("@/pages/marketing/HeyCenaivaPage"));
const LoyaltyPage = lazy(() => import("@/pages/marketing/LoyaltyPage"));
const RestaurantsPage = lazy(() => import("@/pages/marketing/RestaurantsPage"));
const AboutPage = lazy(() => import("@/pages/marketing/AboutPage"));
const AccountPage = lazy(() => import("@/pages/customer/AccountPage"));
const BookingDetailsPage = lazy(() => import("@/pages/customer/BookingDetailsPage"));
const BookingsPage = lazy(() => import("@/pages/customer/BookingsPage"));
const DiscoverPage = lazy(() => import("@/pages/customer/DiscoverPage"));
const DealsPage = lazy(() => import("@/pages/customer/DealsPage"));
const RestaurantPublicPage = lazy(() => import("@/pages/customer/RestaurantPublicPage"));
const AuthCallbackPage = lazy(() => import("@/pages/auth/AuthCallbackPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/auth/ForgotPasswordPage"));
const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("@/pages/auth/RegisterPage"));
const ResetPasswordPage = lazy(() => import("@/pages/auth/ResetPasswordPage"));
const SetupPage = lazy(() => import("@/pages/auth/SetupPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const DashboardLayout = lazy(() => import("@/pages/dashboard/DashboardLayout"));
const OverviewPage = lazy(() => import("@/pages/dashboard/OverviewPage"));
const ReservationsPage = lazy(() => import("@/pages/dashboard/ReservationsPage"));
const HostViewPage = lazy(() => import("@/pages/dashboard/HostViewPage"));
const OrdersPage = lazy(() => import("@/pages/dashboard/OrdersPage"));
const MenuPage = lazy(() => import("@/pages/dashboard/MenuPage"));
const CrmPage = lazy(() => import("@/pages/dashboard/CrmPage"));
const AnalyticsPage = lazy(() => import("@/pages/dashboard/AnalyticsPage"));
const ExpensesPage = lazy(() => import("@/pages/dashboard/ExpensesPage"));
const EventsPage = lazy(() => import("@/pages/dashboard/EventsPage"));
const PromotionsPage = lazy(() => import("@/pages/dashboard/PromotionsPage"));
const ExportPage = lazy(() => import("@/pages/dashboard/ExportPage"));
const SettingsPage = lazy(() => import("@/pages/dashboard/SettingsPage"));
const FloorPlanPage = lazy(() => import("@/pages/dashboard/FloorPlanPage"));
const HostPage = lazy(() => import("@/pages/dashboard/HostPage"));
const AcceptInvitePage = lazy(() => import("@/pages/auth/AcceptInvitePage"));

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/hey-cenaiva" element={<HeyCenaivaPage />} />
        <Route path="/loyalty" element={<LoyaltyPage />} />
        <Route path="/restaurants" element={<RestaurantsPage />} />
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
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
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
              <DiscoverPage />
            </RequireAuth>
          }
        />
        <Route
          path="/account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
        <Route
          path="/bookings"
          element={
            <RequireAuth>
              <RequireCustomer>
                <BookingsPage />
              </RequireCustomer>
            </RequireAuth>
          }
        />
        <Route
          path="/bookings/:reservationId"
          element={
            <RequireAuth>
              <RequireCustomer>
                <BookingDetailsPage />
              </RequireCustomer>
            </RequireAuth>
          }
        />
        <Route
          path="/deals"
          element={
            <RequireAuth>
              <RequireCustomer>
                <DealsPage />
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
          <Route path="host-view" element={<HostViewPage />} />
          <Route path="staff-invites" element={<HostPage />} />
          <Route path="host" element={<Navigate to="/dashboard/staff-invites" replace />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="crm" element={<CrmPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="expenses" element={<ExpensesPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="promotions" element={<PromotionsPage />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="restaurant" element={<SettingsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="/:restaurantSlug" element={<RestaurantPublicPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

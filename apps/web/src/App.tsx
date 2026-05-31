import { lazy, Suspense } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AuthProvider } from "@/contexts/auth-context";
import { CenaivaVoicePreferenceProvider } from "@/contexts/CenaivaVoicePreferenceProvider";
import { AssistantProvider, useAssistant } from "@/components/cenaiva/AssistantProvider";
import { VoiceOrb } from "@/components/cenaiva/VoiceOrb";
import { AppErrorBoundary } from "@/components/error/AppErrorBoundary";
import { DevSupabaseBanner } from "@/components/layout/DevSupabaseBanner";
import { CookieConsentBanner } from "@/components/legal/CookieConsentBanner";
import { NewDeviceAlertBanner } from "@/components/account/NewDeviceAlertBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/routes/AppRoutes";
import { useUser } from "@/hooks/useUser";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";
import { ReservationReviewPrompt } from "@/components/customer/ReservationReviewPrompt";
import { DinerBottomNav } from "@/components/customer/DinerBottomNav";

const PUBLIC_PATHS = new Set(["/", "/features", "/about", "/login", "/register", "/forgot-password", "/reset-password", "/hey-cenaiva", "/loyalty", "/restaurants", "/book-a-demo"]);
const CenaivaVoiceShell = lazy(() =>
  import("@/components/cenaiva/CenaivaVoiceShell").then((module) => ({
    default: module.CenaivaVoiceShell,
  })),
);

function AuthedCenaivaUI() {
  const { user } = useUser();
  const { pathname } = useLocation();

  if (!user || PUBLIC_PATHS.has(pathname) || pathname.startsWith("/auth/")) return null;

  // Dashboard mounts its own legacy CenaivaProvider + drawer inside DashboardLayout.
  // Hide the customer voice FAB and shell for dashboard routes.
  if (pathname.startsWith("/dashboard")) return null;

  // All other routes (customer-facing) — voice-first orb FAB + voice shell.
  // Mounting the shell here (instead of at the app root) keeps usePublicRestaurants,
  // useCenaivaVoice, and MapLibre GL contexts from living on /, /login, /dashboard/*
  // — the biggest source of idle memory growth.
  return (
    <>
      <CustomerVoiceOrbFAB />
      <Suspense fallback={null}>
        <CenaivaVoiceShell initialGreeting />
      </Suspense>
    </>
  );
}

// The diner bottom tab bar shows for ALL users (logged in or out) on the
// app/diner surfaces — unlike the voice FAB above, which is logged-in only.
// Hidden on marketing, auth, owner-dashboard, and the owner-onboarding wizard.
function DinerBottomNavMount() {
  const { pathname } = useLocation();
  if (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/setup") ||
    pathname.startsWith("/drafts")
  ) {
    return null;
  }
  return (
    <>
      <DinerBottomNav />
      {/* Reserve space at the bottom of the document so the fixed mobile tab
          bar never covers the last of the page content. Mobile only — the bar
          (and this spacer) are md:hidden. Height matches DinerBottomNav. */}
      <div aria-hidden className="h-[calc(3.5rem+env(safe-area-inset-bottom))] md:hidden" />
    </>
  );
}

function AuthedReservationReviewPrompt() {
  const { user, profile } = useUser();
  const { pathname } = useLocation();

  if (!user || !profile || PUBLIC_PATHS.has(pathname) || pathname.startsWith("/auth/")) return null;
  if (pathname.startsWith("/dashboard")) return null;
  // /discover is the diner's browse surface — a review-prompt modal would
  // compete with the voice shell. Keep it hidden here.
  if (pathname === "/discover") return null;

  return <ReservationReviewPrompt />;
}

function CustomerVoiceOrbFAB() {
  const assistant = useAssistant();
  const { state } = useAssistantStore();
  const { pathname } = useLocation();

  // /discover has the "Concierge" nav button (CustomerNav.tsx) which calls
  // assistant.open() — the floating FAB would be redundant there.
  if (pathname === "/discover") return null;
  // Owner onboarding wizard owns the screen; the diner-side mic is distracting
  // and overlaps the footer buttons.
  if (pathname.startsWith("/setup")) return null;
  if (pathname.startsWith("/drafts")) return null;
  // Hide FAB while shell is open
  if (state.isOpen) return null;

  return (
    <div className="fixed right-6 z-40 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-6">
      <VoiceOrb
        status={state.voiceStatus}
        onClick={() => assistant?.open(undefined, undefined, { autoListen: true })}
      />
    </div>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <CenaivaVoicePreferenceProvider>
              <AssistantProvider>
                <TooltipProvider delayDuration={300}>
                  <DevSupabaseBanner />
                  <AppRoutes />
                  <AuthedCenaivaUI />
                  <DinerBottomNavMount />
                  <AuthedReservationReviewPrompt />
                  <CookieConsentBanner />
                  <NewDeviceAlertBanner />
                  <Toaster
                    richColors
                    position="top-center"
                    duration={6000}
                    toastOptions={{
                      style: {
                        background: "#1A1A1A",
                        border: "1px solid #2E2E2E",
                        color: "#FFFFFF",
                      },
                    }}
                  />
                </TooltipProvider>
              </AssistantProvider>
            </CenaivaVoicePreferenceProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}

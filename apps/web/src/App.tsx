import { lazy, Suspense } from "react";
import { BrowserRouter, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/contexts/auth-context";
import { AssistantProvider, useAssistant } from "@/components/cenaiva/AssistantProvider";
import { VoiceOrb } from "@/components/cenaiva/VoiceOrb";
import { DevSupabaseBanner } from "@/components/layout/DevSupabaseBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/routes/AppRoutes";
import { useUser } from "@/hooks/useUser";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";

const PUBLIC_PATHS = new Set(["/", "/features", "/about", "/login", "/register", "/forgot-password", "/reset-password"]);
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

function CustomerVoiceOrbFAB() {
  const assistant = useAssistant();
  const { state } = useAssistantStore();
  const { pathname } = useLocation();

  // /discover has a "Hey Cenaiva" button in the header — no floating FAB needed
  if (pathname === "/discover") return null;
  // Hide FAB while shell is open
  if (state.isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <VoiceOrb
        status={state.voiceStatus}
        onClick={() => assistant?.open(undefined, undefined, { autoListen: true })}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AssistantProvider>
          <TooltipProvider delayDuration={300}>
            <DevSupabaseBanner />
            <AppRoutes />
            <AuthedCenaivaUI />
            <Toaster
              richColors
              position="top-center"
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
      </AuthProvider>
    </BrowserRouter>
  );
}

import { BrowserRouter, useLocation } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/contexts/auth-context";
// Legacy staff chat (owner mode on /dashboard) — kept untouched
import { CenaivaProvider } from "@/components/cenaiva/CenaivaProvider";
import { CenaivaButton } from "@/components/cenaiva/CenaivaButton";
import { CenaivaDrawer } from "@/components/cenaiva/CenaivaDrawer";
// New voice-first customer assistant
import { AssistantProvider, useAssistant } from "@/components/cenaiva/AssistantProvider";
import { CenaivaVoiceShell } from "@/components/cenaiva/CenaivaVoiceShell";
import { VoiceOrb } from "@/components/cenaiva/VoiceOrb";
import { DevSupabaseBanner } from "@/components/layout/DevSupabaseBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/routes/AppRoutes";
import { useUser } from "@/hooks/useUser";
import { useAssistantStore } from "@/components/cenaiva/AssistantStore";

const PUBLIC_PATHS = new Set(["/", "/features", "/about", "/login", "/register", "/forgot-password", "/reset-password"]);

function AuthedCenaivaUI() {
  const { user, isStaff } = useUser();
  const { pathname } = useLocation();

  if (!user || PUBLIC_PATHS.has(pathname) || pathname.startsWith("/auth/")) return null;

  if (isStaff) {
    // Staff / owner mode — legacy typed chat for dashboard
    return (
      <>
        <CenaivaButton />
        <CenaivaDrawer />
      </>
    );
  }

  // Customer mode — voice-first orb (shell is rendered inline on DiscoverPage)
  return <CustomerVoiceOrbFAB />;
}

function CustomerVoiceOrbFAB() {
  const assistant = useAssistant();
  const { state } = useAssistantStore();
  const { pathname } = useLocation();

  // Don't show FAB on discover page (shell is embedded there)
  if (pathname === "/discover") return null;
  // Don't show when shell is open
  if (state.isOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 z-40">
      <VoiceOrb
        status={state.voiceStatus}
        onClick={() => assistant?.open()}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CenaivaProvider>
          <AssistantProvider>
            <TooltipProvider delayDuration={300}>
              <DevSupabaseBanner />
              <AppRoutes />
              <AuthedCenaivaUI />
              {/* Global voice shell (for non-discover pages) */}
              <CenaivaVoiceShell />
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
        </CenaivaProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

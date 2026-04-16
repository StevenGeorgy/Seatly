import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/contexts/auth-context";
import { CenaivaProvider } from "@/components/cenaiva/CenaivaProvider";
import { CenaivaButton } from "@/components/cenaiva/CenaivaButton";
import { CenaivaDrawer } from "@/components/cenaiva/CenaivaDrawer";
import { DevSupabaseBanner } from "@/components/layout/DevSupabaseBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/routes/AppRoutes";
import { useUser } from "@/hooks/useUser";

function CenaivaGate() {
  const { user } = useUser();
  if (!user) return null;
  return (
    <CenaivaProvider>
      <CenaivaButton />
      <CenaivaDrawer />
    </CenaivaProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          <DevSupabaseBanner />
          <AppRoutes />
          <CenaivaGate />
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
      </AuthProvider>
    </BrowserRouter>
  );
}

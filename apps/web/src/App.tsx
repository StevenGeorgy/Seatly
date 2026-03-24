import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/contexts/auth-context";
import { DevSupabaseBanner } from "@/components/layout/DevSupabaseBanner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppRoutes } from "@/routes/AppRoutes";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider delayDuration={300}>
          <DevSupabaseBanner />
          <AppRoutes />
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

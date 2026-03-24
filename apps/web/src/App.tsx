import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";

import { AuthProvider } from "@/contexts/auth-context";
import { DevSupabaseBanner } from "@/components/layout/DevSupabaseBanner";
import { AppRoutes } from "@/routes/AppRoutes";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DevSupabaseBanner />
        <AppRoutes />
        <Toaster richColors position="top-center" />
      </AuthProvider>
    </BrowserRouter>
  );
}

import { useContext } from "react";

import { AuthContext, type AuthContextValue } from "@/contexts/auth-context";

export function useUser(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useUser must be used within AuthProvider");
  }
  return ctx;
}

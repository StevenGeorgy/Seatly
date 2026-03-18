"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/AuthContext";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user === null) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background-dark">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-gold border-t-transparent"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (user === null) {
    return null;
  }

  return <>{children}</>;
}

"use client";

import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { AssistantFloatingWidget } from "@/components/assistant/AssistantFloatingWidget";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <div className="flex min-h-screen bg-background-dark">
        <Sidebar />
        <div className="flex flex-1 flex-col">
          <Header />
          <main className="flex-1 p-xl">{children}</main>
        </div>
        <AssistantFloatingWidget />
      </div>
    </ProtectedRoute>
  );
}

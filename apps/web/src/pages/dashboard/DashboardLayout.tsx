import { Outlet } from "react-router-dom";

import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { DashboardTopBar } from "@/components/dashboard/DashboardTopBar";

export default function DashboardLayout() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col sm:flex-row">
      <DashboardSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <DashboardTopBar />
        <div className="flex-1 p-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

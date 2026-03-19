"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";
import { FloorPlanEditor } from "@/components/floor-plan/FloorPlanEditor";
import { PAGE_HEADERS } from "@/lib/page-headers";

export default function FloorPlanEditorPage() {
  const searchParams = useSearchParams();
  const state = searchParams.get("state") ?? undefined;

  const loading = state === "loading";
  const error = state === "error";

  if (loading) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.floorPlanEditor} />
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader {...PAGE_HEADERS.floorPlanEditor} />
        <div className="flex flex-col items-center justify-center app-card p-xl text-center">
          <p className="text-base font-medium text-error">
            Something went wrong. Please try again.
          </p>
          <Link
            href="/settings/floor-plan"
            className="mt-lg rounded-md bg-error px-lg py-sm text-sm font-medium text-text-on-gold hover:opacity-90"
          >
            Retry
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      <PageHeader {...PAGE_HEADERS.floorPlanEditor} />
      <div className="flex-1 min-h-0">
        <FloorPlanEditor />
      </div>
    </div>
  );
}

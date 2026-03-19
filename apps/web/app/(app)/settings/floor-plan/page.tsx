"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadingState } from "@/components/ui/LoadingState";
import { PageHeader } from "@/components/layout/PageHeader";
import { FloorPlanEditor } from "@/components/floor-plan/FloorPlanEditor";

export default function FloorPlanEditorPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const stateParam = searchParams.state;
  const state =
    typeof stateParam === "string"
      ? stateParam
      : Array.isArray(stateParam)
        ? stateParam[0]
        : undefined;

  const loading = state === "loading";
  const error = state === "error";

  if (loading) {
    return (
      <div>
        <PageHeader title="Floor Plan Editor" />
        <LoadingState />
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Floor Plan Editor" />
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
      <PageHeader title="Floor Plan Editor" />
      <div className="flex-1 min-h-0">
        <FloorPlanEditor />
      </div>
    </div>
  );
}

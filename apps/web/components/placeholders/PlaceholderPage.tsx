import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";

interface PlaceholderPageProps {
  title: string;
  description: string;
  label?: string;
}

export function PlaceholderPage({ title, description, label = "Coming soon" }: PlaceholderPageProps) {
  return (
    <>
      <PageHeader title={title} label={label} subtitle={description} icon={Sparkles} />
      <EmptyState title="Coming soon" message={description} />
    </>
  );
}

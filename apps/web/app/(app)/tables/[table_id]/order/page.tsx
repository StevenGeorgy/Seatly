import { PlaceholderPage } from "@/components/placeholders/PlaceholderPage";

export default function TableOrderPage({
  params,
}: {
  params: { table_id: string };
}) {
  return (
    <PlaceholderPage
      title={`Table Order`}
      description="Full order management for this table. Pre-ordered items, add new items, kitchen status per dish."
    />
  );
}

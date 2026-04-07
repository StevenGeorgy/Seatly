/** Shared DB row shapes for floor plan fetches — avoids circular imports with `useFloorPlan`. */

export type TableRow = {
  id: string;
  restaurant_id: string;
  table_number: string | null;
  label: string | null;
  capacity: number;
  min_party: number | null;
  section: string | null;
  section_id: string | null;
  position_x: number | null;
  position_y: number | null;
  shape: string;
  status: string;
  combined_with: string[] | null;
  seated_count: number;
  qr_code_url: string | null;
  notes: string | null;
  is_active: boolean;
  updated_at: string | null;
};

export type FloorPlanRow = {
  id: string;
  restaurant_id: string;
  section_id: string | null;
  name: string;
  layout: { walls: unknown[]; tables: unknown[]; decorations: unknown[] } | null;
  canvas_width: number;
  canvas_height: number;
  is_active: boolean;
};

export type SectionRow = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

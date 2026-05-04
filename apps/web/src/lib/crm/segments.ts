export type CrmSegment = "blocked" | "vip" | "loyalty" | "returning" | "new";
export type CampaignSegment = Extract<CrmSegment, "vip" | "loyalty" | "returning">;

export const VIP_VISIT_THRESHOLD = 20;
export const LOYALTY_VISIT_THRESHOLD = 8;
export const RETURNING_VISIT_THRESHOLD = 2;

export const CAMPAIGN_SEGMENTS: readonly CampaignSegment[] = ["vip", "loyalty", "returning"];

export type SegmentableGuest = {
  is_blocked?: boolean | null;
  total_visits?: number | null;
};

export function segmentForGuest(guest: SegmentableGuest): CrmSegment {
  if (guest.is_blocked) return "blocked";
  const visits = guest.total_visits ?? 0;
  if (visits >= VIP_VISIT_THRESHOLD) return "vip";
  if (visits >= LOYALTY_VISIT_THRESHOLD) return "loyalty";
  if (visits >= RETURNING_VISIT_THRESHOLD) return "returning";
  return "new";
}

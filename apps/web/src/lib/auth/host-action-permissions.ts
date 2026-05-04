export type StaffOperationalAction =
  | "reservation.create"
  | "reservation.seat"
  | "reservation.noShow"
  | "reservation.complete"
  | "reservation.cancel"
  | "reservation.delete"
  | "reservation.overrideAvailability"
  | "reservation.editSensitiveGuest"
  | "table.status"
  | "floor.layout"
  | "settings.manage";

export type StaffActionLevel = "allowed" | "managerApproval" | "ownerManagerOnly";

export const HOST_ACTION_LEVELS: Record<StaffOperationalAction, StaffActionLevel> = {
  "reservation.create": "allowed",
  "reservation.seat": "allowed",
  "reservation.noShow": "allowed",
  "reservation.complete": "allowed",
  "reservation.cancel": "managerApproval",
  "reservation.delete": "managerApproval",
  "reservation.overrideAvailability": "managerApproval",
  "reservation.editSensitiveGuest": "managerApproval",
  "table.status": "allowed",
  "floor.layout": "ownerManagerOnly",
  "settings.manage": "ownerManagerOnly",
};

export function hostActionNeedsManagerApproval(action: StaffOperationalAction): boolean {
  return HOST_ACTION_LEVELS[action] === "managerApproval";
}

export function hostActionIsOwnerManagerOnly(action: StaffOperationalAction): boolean {
  return HOST_ACTION_LEVELS[action] === "ownerManagerOnly";
}

import { z } from "zod";
import { EmailLower, Uuid } from "./base.ts";

export const StaffRole = z.enum([
  "host",
  "server",
  "manager",
  "owner",
  "kitchen",
  "bartender",
]);

export const StaffInviteSchema = z.object({
  restaurant_id: Uuid,
  email: EmailLower,
  role: StaffRole,
  hourly_rate: z.number().finite().nonnegative().max(1000).optional(),
  employment_type: z.enum(["full_time", "part_time", "contract"]).optional(),
});

export type StaffInviteInput = z.infer<typeof StaffInviteSchema>;

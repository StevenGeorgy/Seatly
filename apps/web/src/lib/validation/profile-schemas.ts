import { z } from "zod";

export const profileUpdateSchema = z.object({
  full_name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Invalid email address"),
  phone: z.string().trim().max(30).optional().or(z.literal("")),
  dietary_restrictions: z.array(z.string()).default([]),
  allergies: z.array(z.string()).default([]),
});

export type ProfileUpdateValues = z.infer<typeof profileUpdateSchema>;

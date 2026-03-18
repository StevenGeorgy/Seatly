/**
 * Seatly Shared Types
 * All TypeScript types live here — never define the same type twice.
 */

export type Role =
  | "customer"
  | "host"
  | "waiter"
  | "owner"
  | "kitchen"
  | "admin";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  restaurantId: string | null;
  avatarUrl: string | null;
}

export interface NavItem {
  href: string;
  label: string;
  roles: Role[];
}

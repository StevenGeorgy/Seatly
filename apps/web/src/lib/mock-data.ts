/**
 * Mock data for development preview.
 * Used by hooks when the database returns no rows.
 * Remove or disable when real seed data is in place.
 */

import type { ReservationRow } from "@/hooks/useReservations";
import type { TableRow, SectionRow } from "@/hooks/useFloorPlan";
import type { WaitlistRow } from "@/hooks/useWaitlist";
import type { OrderRow } from "@/hooks/useOrders";
import type { MenuCategoryRow, MenuItemRow } from "@/hooks/useMenuItems";
import type { AnalyticsRow } from "@/hooks/useAnalytics";
import type { GuestRow } from "@/hooks/useGuests";
import type { StaffMemberRow } from "@/hooks/useStaffRoster";
import type { ExpenseRow } from "@/hooks/useExpenses";
import type { EventRow } from "@/hooks/useEvents";

const RID = "mock-restaurant-id";
const today = new Date().toISOString().split("T")[0];

function todayAt(hour: number, min = 0): string {
  const d = new Date();
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

// ─── Reservations ───────────────────────────────────────────────
export const MOCK_RESERVATIONS: ReservationRow[] = [
  {
    id: "res-1", restaurant_id: RID, guest_id: "g-1", table_id: "t-1", shift_id: null,
    party_size: 4, reserved_at: todayAt(18, 0), status: "confirmed",
    source: "website", confirmation_code: "SEAT-1A2B", special_request: "Window seat preferred",
    occasion: "Anniversary", dietary_notes: "Gluten-free", internal_notes: null,
    no_show_risk_score: 12, waiter_id: null, deposit_amount: 25, deposit_status: "paid",
    is_guest_checkout: false, guest_email: null, guest_phone: null, guest_full_name: null,
    confirmed_at: todayAt(10), checked_in_at: null, seated_at: null, completed_at: null, cancelled_at: null, created_at: todayAt(9),
    guests: { full_name: "Olivia Martinez", email: "olivia@example.com", phone: "+1 514-555-0101" },
  },
  {
    id: "res-2", restaurant_id: RID, guest_id: "g-2", table_id: "t-3", shift_id: null,
    party_size: 2, reserved_at: todayAt(18, 30), status: "confirmed",
    source: "phone", confirmation_code: "SEAT-3C4D", special_request: null,
    occasion: null, dietary_notes: null, internal_notes: "Regular customer",
    no_show_risk_score: 5, waiter_id: null, deposit_amount: null, deposit_status: null,
    is_guest_checkout: false, guest_email: null, guest_phone: null, guest_full_name: null,
    confirmed_at: todayAt(11), checked_in_at: null, seated_at: null, completed_at: null, cancelled_at: null, created_at: todayAt(8),
    guests: { full_name: "James Chen", email: "james.chen@example.com", phone: "+1 438-555-0202" },
  },
  {
    id: "res-3", restaurant_id: RID, guest_id: "g-3", table_id: "t-5", shift_id: null,
    party_size: 6, reserved_at: todayAt(19, 0), status: "pending",
    source: "website", confirmation_code: "SEAT-5E6F", special_request: "Birthday cake at 8pm",
    occasion: "Birthday", dietary_notes: "Nut allergy (1 guest)", internal_notes: null,
    no_show_risk_score: 35, waiter_id: null, deposit_amount: 50, deposit_status: "pending",
    is_guest_checkout: false, guest_email: null, guest_phone: null, guest_full_name: null,
    confirmed_at: null, checked_in_at: null, seated_at: null, completed_at: null, cancelled_at: null, created_at: todayAt(12),
    guests: { full_name: "Sophie Tremblay", email: "sophie.t@example.com", phone: "+1 514-555-0303" },
  },
  {
    id: "res-4", restaurant_id: RID, guest_id: "g-4", table_id: "t-2", shift_id: null,
    party_size: 2, reserved_at: todayAt(19, 30), status: "confirmed",
    source: "google", confirmation_code: "SEAT-7G8H", special_request: "Vegetarian tasting menu",
    occasion: null, dietary_notes: "Both vegetarian", internal_notes: null,
    no_show_risk_score: 8, waiter_id: null, deposit_amount: null, deposit_status: null,
    is_guest_checkout: false, guest_email: null, guest_phone: null, guest_full_name: null,
    confirmed_at: todayAt(13), checked_in_at: null, seated_at: null, completed_at: null, cancelled_at: null, created_at: todayAt(11),
    guests: { full_name: "Liam Patel", email: "liam.p@example.com", phone: "+1 647-555-0404" },
  },
  {
    id: "res-5", restaurant_id: RID, guest_id: "g-5", table_id: "t-4", shift_id: null,
    party_size: 3, reserved_at: todayAt(20, 0), status: "confirmed",
    source: "website", confirmation_code: "SEAT-9I0J", special_request: null,
    occasion: null, dietary_notes: null, internal_notes: "VIP — comp dessert",
    no_show_risk_score: 2, waiter_id: null, deposit_amount: null, deposit_status: null,
    is_guest_checkout: false, guest_email: null, guest_phone: null, guest_full_name: null,
    confirmed_at: todayAt(14), checked_in_at: null, seated_at: null, completed_at: null, cancelled_at: null, created_at: todayAt(10),
    guests: { full_name: "Emma Dubois", email: "emma.d@example.com", phone: "+1 514-555-0505" },
  },
  {
    id: "res-6", restaurant_id: RID, guest_id: "g-6", table_id: "t-6", shift_id: null,
    party_size: 8, reserved_at: todayAt(20, 30), status: "confirmed",
    source: "phone", confirmation_code: "SEAT-KL1M", special_request: "Private corner",
    occasion: "Business dinner", dietary_notes: null, internal_notes: null,
    no_show_risk_score: 62, waiter_id: null, deposit_amount: 100, deposit_status: "paid",
    is_guest_checkout: false, guest_email: null, guest_phone: null, guest_full_name: null,
    confirmed_at: todayAt(15), checked_in_at: null, seated_at: null, completed_at: null, cancelled_at: null, created_at: todayAt(7),
    guests: { full_name: "Noah Williams", email: "noah.w@example.com", phone: "+1 416-555-0606" },
  },
  {
    id: "res-7", restaurant_id: RID, guest_id: null, table_id: null, shift_id: null,
    party_size: 2, reserved_at: todayAt(17, 30), status: "seated",
    source: "walk-in", confirmation_code: null, special_request: null,
    occasion: null, dietary_notes: null, internal_notes: null,
    no_show_risk_score: null, waiter_id: null, deposit_amount: null, deposit_status: null,
    is_guest_checkout: true, guest_email: "walk.in@example.com", guest_phone: null, guest_full_name: "Walk-in Guest",
    confirmed_at: null, checked_in_at: todayAt(17, 25), seated_at: todayAt(17, 30), completed_at: null, cancelled_at: null, created_at: todayAt(17, 25),
    guests: null,
  },
];

// ─── Floor Plan ─────────────────────────────────────────────────
export const MOCK_SECTIONS: SectionRow[] = [
  { id: "sec-1", restaurant_id: RID, name: "Main Dining", sort_order: 0, is_active: true },
  { id: "sec-2", restaurant_id: RID, name: "Booths", sort_order: 1, is_active: true },
  { id: "sec-3", restaurant_id: RID, name: "Bar Area", sort_order: 2, is_active: true },
];

export const MOCK_TABLES: TableRow[] = [
  { id: "t-1", restaurant_id: RID, table_number: "T1", label: "T1", capacity: 4, min_party: 2, section: "Main Dining", section_id: "sec-1", position_x: 100, position_y: 80, shape: "circle", status: "reserved", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-2", restaurant_id: RID, table_number: "T2", label: "T2", capacity: 4, min_party: 2, section: "Main Dining", section_id: "sec-1", position_x: 260, position_y: 80, shape: "circle", status: "empty", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-3", restaurant_id: RID, table_number: "T3", label: "T3", capacity: 6, min_party: 3, section: "Main Dining", section_id: "sec-1", position_x: 80, position_y: 240, shape: "rectangle", status: "occupied", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-4", restaurant_id: RID, table_number: "T4", label: "T4", capacity: 2, min_party: 1, section: "Main Dining", section_id: "sec-1", position_x: 420, position_y: 80, shape: "circle", status: "empty", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-5", restaurant_id: RID, table_number: "T5", label: "T5", capacity: 8, min_party: 4, section: "Main Dining", section_id: "sec-1", position_x: 400, position_y: 220, shape: "circle", status: "reserved", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-6", restaurant_id: RID, table_number: "B1", label: "B1", capacity: 4, min_party: 2, section: "Booths", section_id: "sec-2", position_x: 60, position_y: 380, shape: "booth", status: "occupied", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-7", restaurant_id: RID, table_number: "B2", label: "B2", capacity: 4, min_party: 2, section: "Booths", section_id: "sec-2", position_x: 200, position_y: 380, shape: "booth", status: "empty", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
  { id: "t-8", restaurant_id: RID, table_number: "Bar", label: "Bar", capacity: 6, min_party: 1, section: "Bar Area", section_id: "sec-3", position_x: 380, position_y: 380, shape: "bar", status: "occupied", combined_with: null, qr_code_url: null, notes: null, is_active: true, updated_at: null },
];

// ─── Waitlist ───────────────────────────────────────────────────
export const MOCK_WAITLIST: WaitlistRow[] = [
  { id: "wl-1", restaurant_id: RID, guest_name: "Marcus Johnson", phone: "+1 514-555-1001", user_profile_id: null, party_size: 3, position: 1, status: "waiting", estimated_wait_minutes: 15, contact_method: "sms", remote_join: false, notified_at: null, response: null, created_at: todayAt(17, 45) },
  { id: "wl-2", restaurant_id: RID, guest_name: "Aisha Khalil", phone: "+1 438-555-1002", user_profile_id: null, party_size: 2, position: 2, status: "waiting", estimated_wait_minutes: 25, contact_method: "sms", remote_join: true, notified_at: null, response: null, created_at: todayAt(17, 50) },
  { id: "wl-3", restaurant_id: RID, guest_name: "David Park", phone: "+1 647-555-1003", user_profile_id: null, party_size: 5, position: 3, status: "waiting", estimated_wait_minutes: 35, contact_method: "call", remote_join: false, notified_at: null, response: null, created_at: todayAt(17, 55) },
  { id: "wl-4", restaurant_id: RID, guest_name: "Claire Fontaine", phone: "+1 514-555-1004", user_profile_id: null, party_size: 2, position: 4, status: "waiting", estimated_wait_minutes: 40, contact_method: "sms", remote_join: true, notified_at: null, response: null, created_at: todayAt(18, 0) },
  { id: "wl-5", restaurant_id: RID, guest_name: "Roberto Silva", phone: "+1 416-555-1005", user_profile_id: null, party_size: 4, position: 5, status: "waiting", estimated_wait_minutes: 50, contact_method: "sms", remote_join: false, notified_at: null, response: null, created_at: todayAt(18, 5) },
];

// ─── Orders (KDS) ───────────────────────────────────────────────
export const MOCK_ORDERS: OrderRow[] = [
  {
    id: "ord-1", reservation_id: "res-7", restaurant_id: RID, guest_id: null,
    is_preorder: false, order_type: "dine_in", status: "pending",
    subtotal: 68.50, tax_amount: 8.90, tip_amount: null, total_amount: 77.40,
    created_at: todayAt(17, 35),
    order_items: [
      { id: "oi-1", order_id: "ord-1", menu_item_id: "mi-1", quantity: 2, unit_price: 16.00, line_total: 32.00, modifications: null, course: "appetizer", status: "pending", added_by: null, kitchen_started_at: null, kitchen_ready_at: null, menu_items: { name: "Bruschetta", name_fr: "Bruschetta" } },
      { id: "oi-2", order_id: "ord-1", menu_item_id: "mi-4", quantity: 1, unit_price: 36.50, line_total: 36.50, modifications: "Medium-rare", course: "main", status: "pending", added_by: null, kitchen_started_at: null, kitchen_ready_at: null, menu_items: { name: "Grilled Ribeye", name_fr: "Entrecôte grillée" } },
    ],
    reservations: { table_id: "t-3", tables: { table_number: "3" } },
  },
  {
    id: "ord-2", reservation_id: null, restaurant_id: RID, guest_id: null,
    is_preorder: false, order_type: "dine_in", status: "preparing",
    subtotal: 45.00, tax_amount: 5.85, tip_amount: null, total_amount: 50.85,
    created_at: todayAt(17, 20),
    order_items: [
      { id: "oi-3", order_id: "ord-2", menu_item_id: "mi-3", quantity: 1, unit_price: 22.00, line_total: 22.00, modifications: null, course: "main", status: "preparing", added_by: null, kitchen_started_at: todayAt(17, 22), kitchen_ready_at: null, menu_items: { name: "Salmon Teriyaki", name_fr: "Saumon teriyaki" } },
      { id: "oi-4", order_id: "ord-2", menu_item_id: "mi-8", quantity: 1, unit_price: 14.00, line_total: 14.00, modifications: "No onions", course: "appetizer", status: "preparing", added_by: null, kitchen_started_at: todayAt(17, 22), kitchen_ready_at: null, menu_items: { name: "Caesar Salad", name_fr: "Salade César" } },
      { id: "oi-5", order_id: "ord-2", menu_item_id: "mi-10", quantity: 1, unit_price: 9.00, line_total: 9.00, modifications: null, course: "drink", status: "preparing", added_by: null, kitchen_started_at: null, kitchen_ready_at: null, menu_items: { name: "House Red Wine", name_fr: "Vin rouge maison" } },
    ],
    reservations: { table_id: "t-7", tables: { table_number: "P1" } },
  },
  {
    id: "ord-3", reservation_id: null, restaurant_id: RID, guest_id: null,
    is_preorder: false, order_type: "dine_in", status: "preparing",
    subtotal: 55.00, tax_amount: 7.15, tip_amount: null, total_amount: 62.15,
    created_at: todayAt(17, 10),
    order_items: [
      { id: "oi-6", order_id: "ord-3", menu_item_id: "mi-5", quantity: 2, unit_price: 19.00, line_total: 38.00, modifications: null, course: "main", status: "preparing", added_by: null, kitchen_started_at: todayAt(17, 12), kitchen_ready_at: null, menu_items: { name: "Truffle Pasta", name_fr: "Pâtes à la truffe" } },
      { id: "oi-7", order_id: "ord-3", menu_item_id: "mi-9", quantity: 1, unit_price: 12.00, line_total: 12.00, modifications: null, course: "dessert", status: "preparing", added_by: null, kitchen_started_at: null, kitchen_ready_at: null, menu_items: { name: "Crème Brûlée", name_fr: "Crème brûlée" } },
    ],
    reservations: { table_id: "t-10", tables: { table_number: "B1" } },
  },
  {
    id: "ord-4", reservation_id: null, restaurant_id: RID, guest_id: null,
    is_preorder: false, order_type: "dine_in", status: "ready",
    subtotal: 32.00, tax_amount: 4.16, tip_amount: 6.00, total_amount: 42.16,
    created_at: todayAt(17, 0),
    order_items: [
      { id: "oi-8", order_id: "ord-4", menu_item_id: "mi-2", quantity: 1, unit_price: 18.00, line_total: 18.00, modifications: null, course: "main", status: "ready", added_by: null, kitchen_started_at: todayAt(17, 2), kitchen_ready_at: todayAt(17, 18), menu_items: { name: "Margherita Pizza", name_fr: "Pizza Margherita" } },
      { id: "oi-9", order_id: "ord-4", menu_item_id: "mi-1", quantity: 1, unit_price: 14.00, line_total: 14.00, modifications: null, course: "appetizer", status: "ready", added_by: null, kitchen_started_at: todayAt(17, 2), kitchen_ready_at: todayAt(17, 10), menu_items: { name: "Bruschetta", name_fr: "Bruschetta" } },
    ],
    reservations: { table_id: "t-2", tables: { table_number: "2" } },
  },
];

// ─── Menu ───────────────────────────────────────────────────────
export const MOCK_CATEGORIES: MenuCategoryRow[] = [
  { id: "cat-1", restaurant_id: RID, name: "Appetizers", name_fr: "Entrées", description: null, sort_order: 0, available_from: null, available_to: null, is_active: true },
  { id: "cat-2", restaurant_id: RID, name: "Mains", name_fr: "Plats principaux", description: null, sort_order: 1, available_from: null, available_to: null, is_active: true },
  { id: "cat-3", restaurant_id: RID, name: "Desserts", name_fr: "Desserts", description: null, sort_order: 2, available_from: null, available_to: null, is_active: true },
  { id: "cat-4", restaurant_id: RID, name: "Drinks", name_fr: "Boissons", description: null, sort_order: 3, available_from: null, available_to: null, is_active: true },
];

export const MOCK_MENU_ITEMS: MenuItemRow[] = [
  { id: "mi-1", restaurant_id: RID, category_id: "cat-1", category: "Appetizers", name: "Bruschetta", name_fr: "Bruschetta", description: "Grilled sourdough topped with heirloom tomatoes, basil, and aged balsamic", description_fr: null, price: 16.00, cost_price: 4.50, photo_url: null, allergens: ["gluten", "dairy"], dietary_flags: ["vegetarian"], calories: 280, is_available: true, is_preorderable: false, is_featured: true, is_active: true, preparation_time_minutes: 8, spice_level: null, loyalty_points_value: 16, sort_order: 0 },
  { id: "mi-8", restaurant_id: RID, category_id: "cat-1", category: "Appetizers", name: "Caesar Salad", name_fr: "Salade César", description: "Crisp romaine, parmesan croutons, house-made dressing", description_fr: null, price: 14.00, cost_price: 3.80, photo_url: null, allergens: ["gluten", "dairy", "eggs"], dietary_flags: null, calories: 320, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 6, spice_level: null, loyalty_points_value: 14, sort_order: 1 },
  { id: "mi-11", restaurant_id: RID, category_id: "cat-1", category: "Appetizers", name: "Tuna Tartare", name_fr: "Tartare de thon", description: "Fresh ahi tuna, avocado, sesame, crispy wonton chips", description_fr: null, price: 19.00, cost_price: 8.50, photo_url: null, allergens: ["fish", "sesame", "gluten"], dietary_flags: null, calories: 260, is_available: true, is_preorderable: true, is_featured: true, is_active: true, preparation_time_minutes: 10, spice_level: "mild", loyalty_points_value: 19, sort_order: 2 },
  { id: "mi-2", restaurant_id: RID, category_id: "cat-2", category: "Mains", name: "Margherita Pizza", name_fr: "Pizza Margherita", description: "San Marzano tomato, fresh mozzarella, basil, EVOO on a wood-fired crust", description_fr: null, price: 18.00, cost_price: 5.20, photo_url: null, allergens: ["gluten", "dairy"], dietary_flags: ["vegetarian"], calories: 680, is_available: true, is_preorderable: true, is_featured: false, is_active: true, preparation_time_minutes: 15, spice_level: null, loyalty_points_value: 18, sort_order: 0 },
  { id: "mi-3", restaurant_id: RID, category_id: "cat-2", category: "Mains", name: "Salmon Teriyaki", name_fr: "Saumon teriyaki", description: "Atlantic salmon glazed with house teriyaki, jasmine rice, seasonal vegetables", description_fr: null, price: 22.00, cost_price: 9.00, photo_url: null, allergens: ["fish", "soy", "sesame"], dietary_flags: null, calories: 520, is_available: true, is_preorderable: false, is_featured: true, is_active: true, preparation_time_minutes: 18, spice_level: null, loyalty_points_value: 22, sort_order: 1 },
  { id: "mi-4", restaurant_id: RID, category_id: "cat-2", category: "Mains", name: "Grilled Ribeye", name_fr: "Entrecôte grillée", description: "12oz AAA ribeye, truffle butter, roasted fingerlings, grilled asparagus", description_fr: null, price: 36.50, cost_price: 16.00, photo_url: null, allergens: ["dairy"], dietary_flags: null, calories: 920, is_available: true, is_preorderable: true, is_featured: true, is_active: true, preparation_time_minutes: 25, spice_level: null, loyalty_points_value: 37, sort_order: 2 },
  { id: "mi-5", restaurant_id: RID, category_id: "cat-2", category: "Mains", name: "Truffle Pasta", name_fr: "Pâtes à la truffe", description: "Fresh tagliatelle, black truffle cream, parmesan, toasted pine nuts", description_fr: null, price: 19.00, cost_price: 6.50, photo_url: null, allergens: ["gluten", "dairy", "nuts"], dietary_flags: ["vegetarian"], calories: 750, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 14, spice_level: null, loyalty_points_value: 19, sort_order: 3 },
  { id: "mi-12", restaurant_id: RID, category_id: "cat-2", category: "Mains", name: "Duck Confit", name_fr: "Confit de canard", description: "Slow-cooked duck leg, lentils du Puy, cherry gastrique", description_fr: null, price: 28.00, cost_price: 11.00, photo_url: null, allergens: null, dietary_flags: null, calories: 820, is_available: false, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 20, spice_level: null, loyalty_points_value: 28, sort_order: 4 },
  { id: "mi-9", restaurant_id: RID, category_id: "cat-3", category: "Desserts", name: "Crème Brûlée", name_fr: "Crème brûlée", description: "Classic vanilla bean custard, caramelized sugar crust", description_fr: null, price: 12.00, cost_price: 3.00, photo_url: null, allergens: ["dairy", "eggs"], dietary_flags: ["vegetarian"], calories: 380, is_available: true, is_preorderable: false, is_featured: true, is_active: true, preparation_time_minutes: 5, spice_level: null, loyalty_points_value: 12, sort_order: 0 },
  { id: "mi-13", restaurant_id: RID, category_id: "cat-3", category: "Desserts", name: "Chocolate Fondant", name_fr: "Fondant au chocolat", description: "Valrhona dark chocolate lava cake, vanilla ice cream", description_fr: null, price: 14.00, cost_price: 4.00, photo_url: null, allergens: ["dairy", "eggs", "gluten"], dietary_flags: ["vegetarian"], calories: 520, is_available: true, is_preorderable: true, is_featured: false, is_active: true, preparation_time_minutes: 12, spice_level: null, loyalty_points_value: 14, sort_order: 1 },
  { id: "mi-10", restaurant_id: RID, category_id: "cat-4", category: "Drinks", name: "House Red Wine", name_fr: "Vin rouge maison", description: "Côtes du Rhône, 6oz pour", description_fr: null, price: 9.00, cost_price: 2.50, photo_url: null, allergens: ["sulphites"], dietary_flags: null, calories: 150, is_available: true, is_preorderable: false, is_featured: false, is_active: true, preparation_time_minutes: 1, spice_level: null, loyalty_points_value: 9, sort_order: 0 },
  { id: "mi-14", restaurant_id: RID, category_id: "cat-4", category: "Drinks", name: "Espresso Martini", name_fr: "Martini espresso", description: "Vodka, Kahlúa, fresh espresso, vanilla", description_fr: null, price: 16.00, cost_price: 4.50, photo_url: null, allergens: null, dietary_flags: null, calories: 220, is_available: true, is_preorderable: false, is_featured: true, is_active: true, preparation_time_minutes: 3, spice_level: null, loyalty_points_value: 16, sort_order: 1 },
];

// ─── Analytics ──────────────────────────────────────────────────
export const MOCK_ANALYTICS: AnalyticsRow[] = Array.from({ length: 14 }, (_, i) => {
  const date = daysAgo(13 - i);
  const isWeekend = [0, 6].includes(new Date(date).getDay());
  const baseCov = isWeekend ? 85 : 55;
  const covers = baseCov + Math.round(Math.random() * 25);
  const rev = covers * (42 + Math.random() * 18);
  return {
    id: `an-${i}`, restaurant_id: RID, date,
    total_covers: covers, total_revenue: Math.round(rev * 100) / 100,
    total_orders: Math.round(covers * 0.85),
    avg_spend_per_cover: Math.round((rev / covers) * 100) / 100,
    no_show_count: Math.round(Math.random() * 3),
    cancellation_count: Math.round(Math.random() * 4),
    walk_in_count: Math.round(Math.random() * 12) + 5,
    food_revenue: Math.round(rev * 0.65 * 100) / 100,
    drinks_revenue: Math.round(rev * 0.25 * 100) / 100,
    tip_total: Math.round(rev * 0.15 * 100) / 100,
    discount_total: Math.round(rev * 0.02 * 100) / 100,
    labour_cost: Math.round(rev * 0.28 * 100) / 100,
    new_guests_count: Math.round(Math.random() * 8) + 2,
    returning_guests_count: Math.round(Math.random() * 20) + 10,
    loyalty_points_issued: Math.round(rev * 0.8),
    loyalty_points_redeemed: Math.round(Math.random() * 200),
    avg_table_turn_minutes: Math.round(55 + Math.random() * 25),
    top_dishes_json: null,
    computed_at: new Date().toISOString(),
  };
});

// ─── Guests (CRM) ──────────────────────────────────────────────
export const MOCK_GUESTS: GuestRow[] = [
  { id: "g-1", restaurant_id: RID, user_profile_id: null, full_name: "Olivia Martinez", email: "olivia@example.com", phone: "+1 514-555-0101", birthday: "1990-03-15", anniversary: "2018-06-20", tags: ["regular", "wine-lover"], dietary_restrictions: ["gluten-free"], allergies: null, seating_preference: "window", favourite_dishes: ["Grilled Ribeye", "Crème Brûlée"], internal_notes: "Prefers quiet tables", total_visits: 24, total_spend: 2850.00, average_spend_per_visit: 118.75, no_show_count: 0, cancellation_count: 1, is_vip: true, is_blocked: false, loyalty_points_balance: 1420, loyalty_tier: "gold", last_visit_at: daysAgo(3), first_visit_at: daysAgo(365), created_at: daysAgo(365) },
  { id: "g-2", restaurant_id: RID, user_profile_id: null, full_name: "James Chen", email: "james.chen@example.com", phone: "+1 438-555-0202", birthday: "1985-11-08", anniversary: null, tags: ["regular", "business"], dietary_restrictions: null, allergies: null, seating_preference: "booth", favourite_dishes: ["Salmon Teriyaki"], internal_notes: null, total_visits: 18, total_spend: 1620.00, average_spend_per_visit: 90.00, no_show_count: 0, cancellation_count: 0, is_vip: true, is_blocked: false, loyalty_points_balance: 980, loyalty_tier: "gold", last_visit_at: daysAgo(5), first_visit_at: daysAgo(280), created_at: daysAgo(280) },
  { id: "g-3", restaurant_id: RID, user_profile_id: null, full_name: "Sophie Tremblay", email: "sophie.t@example.com", phone: "+1 514-555-0303", birthday: "1995-07-22", anniversary: null, tags: ["occasion-diner"], dietary_restrictions: null, allergies: ["nuts"], seating_preference: null, favourite_dishes: null, internal_notes: null, total_visits: 5, total_spend: 420.00, average_spend_per_visit: 84.00, no_show_count: 1, cancellation_count: 2, is_vip: false, is_blocked: false, loyalty_points_balance: 210, loyalty_tier: "bronze", last_visit_at: daysAgo(14), first_visit_at: daysAgo(120), created_at: daysAgo(120) },
  { id: "g-4", restaurant_id: RID, user_profile_id: null, full_name: "Liam Patel", email: "liam.p@example.com", phone: "+1 647-555-0404", birthday: "1992-01-30", anniversary: null, tags: ["vegetarian"], dietary_restrictions: ["vegetarian"], allergies: null, seating_preference: "patio", favourite_dishes: ["Truffle Pasta", "Bruschetta"], internal_notes: "Always orders the tasting menu", total_visits: 12, total_spend: 1080.00, average_spend_per_visit: 90.00, no_show_count: 0, cancellation_count: 0, is_vip: false, is_blocked: false, loyalty_points_balance: 540, loyalty_tier: "silver", last_visit_at: daysAgo(7), first_visit_at: daysAgo(200), created_at: daysAgo(200) },
  { id: "g-5", restaurant_id: RID, user_profile_id: null, full_name: "Emma Dubois", email: "emma.d@example.com", phone: "+1 514-555-0505", birthday: "1988-09-12", anniversary: "2016-08-15", tags: ["vip", "regular", "influencer"], dietary_restrictions: null, allergies: null, seating_preference: "private room", favourite_dishes: ["Duck Confit", "Espresso Martini"], internal_notes: "Comp dessert on visits — influencer partnership", total_visits: 32, total_spend: 4800.00, average_spend_per_visit: 150.00, no_show_count: 0, cancellation_count: 0, is_vip: true, is_blocked: false, loyalty_points_balance: 2400, loyalty_tier: "platinum", last_visit_at: daysAgo(1), first_visit_at: daysAgo(500), created_at: daysAgo(500) },
  { id: "g-6", restaurant_id: RID, user_profile_id: null, full_name: "Noah Williams", email: "noah.w@example.com", phone: "+1 416-555-0606", birthday: "1978-04-05", anniversary: null, tags: ["business", "high-spender"], dietary_restrictions: null, allergies: null, seating_preference: "corner", favourite_dishes: ["Grilled Ribeye"], internal_notes: "Hosts client dinners monthly", total_visits: 8, total_spend: 3200.00, average_spend_per_visit: 400.00, no_show_count: 2, cancellation_count: 1, is_vip: true, is_blocked: false, loyalty_points_balance: 1600, loyalty_tier: "gold", last_visit_at: daysAgo(10), first_visit_at: daysAgo(180), created_at: daysAgo(180) },
  { id: "g-7", restaurant_id: RID, user_profile_id: null, full_name: "Mia Bergeron", email: "mia.b@example.com", phone: "+1 514-555-0707", birthday: "2000-12-01", anniversary: null, tags: ["new"], dietary_restrictions: ["vegan"], allergies: ["shellfish"], seating_preference: null, favourite_dishes: null, internal_notes: null, total_visits: 1, total_spend: 65.00, average_spend_per_visit: 65.00, no_show_count: 0, cancellation_count: 0, is_vip: false, is_blocked: false, loyalty_points_balance: 65, loyalty_tier: null, last_visit_at: daysAgo(2), first_visit_at: daysAgo(2), created_at: daysAgo(2) },
];

// ─── Staff ──────────────────────────────────────────────────────
export const MOCK_STAFF: StaffMemberRow[] = [
  { id: "sm-1", user_id: "u-1", restaurant_id: RID, role: "owner", is_primary: true, hourly_rate: null, employment_type: "full-time", created_at: daysAgo(365), user_profiles: { full_name: "Steven Georgy", email: "steven@seatly.ca", phone: "+1 514-555-9000", avatar_url: null } },
  { id: "sm-2", user_id: "u-2", restaurant_id: RID, role: "manager", is_primary: false, hourly_rate: 28.00, employment_type: "full-time", created_at: daysAgo(300), user_profiles: { full_name: "Camille Lavoie", email: "camille@seatly.ca", phone: "+1 514-555-9001", avatar_url: null } },
  { id: "sm-3", user_id: "u-3", restaurant_id: RID, role: "server", is_primary: false, hourly_rate: 16.50, employment_type: "full-time", created_at: daysAgo(200), user_profiles: { full_name: "Alex Nguyen", email: "alex.n@seatly.ca", phone: "+1 438-555-9002", avatar_url: null } },
  { id: "sm-4", user_id: "u-4", restaurant_id: RID, role: "server", is_primary: false, hourly_rate: 16.50, employment_type: "part-time", created_at: daysAgo(150), user_profiles: { full_name: "Jade Moreau", email: "jade.m@seatly.ca", phone: "+1 514-555-9003", avatar_url: null } },
  { id: "sm-5", user_id: "u-5", restaurant_id: RID, role: "host", is_primary: false, hourly_rate: 17.00, employment_type: "part-time", created_at: daysAgo(90), user_profiles: { full_name: "Ryan Ibrahim", email: "ryan.i@seatly.ca", phone: "+1 647-555-9004", avatar_url: null } },
  { id: "sm-6", user_id: "u-6", restaurant_id: RID, role: "kitchen", is_primary: false, hourly_rate: 22.00, employment_type: "full-time", created_at: daysAgo(250), user_profiles: { full_name: "Marco Bianchi", email: "marco.b@seatly.ca", phone: "+1 514-555-9005", avatar_url: null } },
  { id: "sm-7", user_id: "u-7", restaurant_id: RID, role: "bar", is_primary: false, hourly_rate: 18.00, employment_type: "full-time", created_at: daysAgo(180), user_profiles: { full_name: "Léa Gagnon", email: "lea.g@seatly.ca", phone: "+1 438-555-9006", avatar_url: null } },
];

// ─── Expenses ───────────────────────────────────────────────────
export const MOCK_EXPENSES: ExpenseRow[] = [
  { id: "exp-1", restaurant_id: RID, category: "food_supplies", vendor_name: "Sysco", description: "Weekly produce & meat delivery", notes: null, amount: 2840.00, tax_amount: 426.00, total_amount: 3266.00, currency: "cad", expense_date: daysAgo(1), receipt_url: null, receipt_type: null, ai_categorized: false, created_at: daysAgo(1), deleted_at: null },
  { id: "exp-2", restaurant_id: RID, category: "beverages", vendor_name: "SAQ", description: "Wine restock — Côtes du Rhône, Chablis", notes: null, amount: 1450.00, tax_amount: 217.50, total_amount: 1667.50, currency: "cad", expense_date: daysAgo(2), receipt_url: null, receipt_type: null, ai_categorized: true, created_at: daysAgo(2), deleted_at: null },
  { id: "exp-3", restaurant_id: RID, category: "equipment", vendor_name: "Restaurant Depot", description: "2x bus tubs, 1x heat lamp", notes: null, amount: 189.00, tax_amount: 28.35, total_amount: 217.35, currency: "cad", expense_date: daysAgo(3), receipt_url: null, receipt_type: null, ai_categorized: false, created_at: daysAgo(3), deleted_at: null },
  { id: "exp-4", restaurant_id: RID, category: "utilities", vendor_name: "Hydro-Québec", description: "March electricity bill", notes: null, amount: 680.00, tax_amount: 0, total_amount: 680.00, currency: "cad", expense_date: daysAgo(5), receipt_url: null, receipt_type: null, ai_categorized: false, created_at: daysAgo(5), deleted_at: null },
  { id: "exp-5", restaurant_id: RID, category: "marketing", vendor_name: "Meta Ads", description: "Instagram campaign — March", notes: null, amount: 350.00, tax_amount: 52.50, total_amount: 402.50, currency: "cad", expense_date: daysAgo(7), receipt_url: null, receipt_type: null, ai_categorized: true, created_at: daysAgo(7), deleted_at: null },
  { id: "exp-6", restaurant_id: RID, category: "cleaning", vendor_name: "CleanCo", description: "Deep cleaning service", notes: null, amount: 420.00, tax_amount: 63.00, total_amount: 483.00, currency: "cad", expense_date: daysAgo(8), receipt_url: null, receipt_type: null, ai_categorized: false, created_at: daysAgo(8), deleted_at: null },
];

// ─── Events ─────────────────────────────────────────────────────
export const MOCK_EVENTS: EventRow[] = [
  { id: "ev-1", restaurant_id: RID, name: "Wine & Dine Tasting", description: "5-course tasting menu paired with sommelier-selected wines from Burgundy. Limited to 30 guests.", date: daysFromNow(5), start_time: "19:00", end_time: "22:00", price_per_person: 95.00, capacity: 30, tickets_sold: 22, is_recurring: false, cover_image_url: null, min_age: 18, dress_code: "Smart casual", is_private: false, created_at: daysAgo(14) },
  { id: "ev-2", restaurant_id: RID, name: "Jazz & Cocktails Night", description: "Live jazz trio with handcrafted cocktail specials all evening.", date: daysFromNow(12), start_time: "20:00", end_time: "23:30", price_per_person: null, capacity: 60, tickets_sold: 0, is_recurring: true, cover_image_url: null, min_age: null, dress_code: null, is_private: false, created_at: daysAgo(7) },
  { id: "ev-3", restaurant_id: RID, name: "Chef's Table Experience", description: "Intimate 8-seat dinner cooked tableside by Chef Marco. Weekly rotating menu.", date: daysFromNow(3), start_time: "19:30", end_time: "22:30", price_per_person: 150.00, capacity: 8, tickets_sold: 7, is_recurring: true, cover_image_url: null, min_age: null, dress_code: "Business casual", is_private: true, created_at: daysAgo(21) },
  { id: "ev-4", restaurant_id: RID, name: "Easter Brunch Buffet", description: "Family-friendly brunch featuring a live carving station, omelette bar, and kids activities.", date: daysFromNow(20), start_time: "10:30", end_time: "14:00", price_per_person: 45.00, capacity: 80, tickets_sold: 34, is_recurring: false, cover_image_url: null, min_age: null, dress_code: null, is_private: false, created_at: daysAgo(10) },
];

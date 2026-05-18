import { describe, expect, it } from "vitest";
import {
  BookingInputSchema,
  ModifyReservationSchema,
  PrepareDepositInputSchema,
  OrderTipSchema,
  OrchestrateTranscriptSchema,
  TRANSCRIPT_MAX_CHARS,
  RestaurantOnboardingSchema,
  MenuItemSchema,
  StaffInviteSchema,
  ProfileUpdateSchema,
  HoursJsonSchema,
} from "@cenaiva/validation";

const futureIso = (daysFromNow = 7) =>
  new Date(Date.now() + daysFromNow * 86400000).toISOString();

const pastIso = () => new Date(Date.now() - 86400000).toISOString();

const okBooking = () => ({
  restaurant_id: "11111111-1111-4111-8111-111111111111",
  shift_id: "22222222-2222-4222-8222-222222222222",
  date_time: futureIso(7),
  party_size: 2,
  guest_name: "Mark Habbi",
  guest_email: "Mark@Example.com",
  guest_phone: "+14165551234",
});

describe("BookingInputSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = BookingInputSchema.safeParse(okBooking());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.guest_email).toBe("mark@example.com");
    }
  });

  it("rejects party_size of 0", () => {
    const r = BookingInputSchema.safeParse({ ...okBooking(), party_size: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects party_size of 31", () => {
    const r = BookingInputSchema.safeParse({ ...okBooking(), party_size: 31 });
    expect(r.success).toBe(false);
  });

  it("rejects oversized guest_name", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      guest_name: "x".repeat(121),
    });
    expect(r.success).toBe(false);
  });

  it("rejects oversized allergies", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      allergies: "a".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("rejects malformed email", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      guest_email: "not-an-email",
    });
    expect(r.success).toBe(false);
  });

  it("rejects phone that isn't E.164", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      guest_phone: "416-555-1234",
    });
    expect(r.success).toBe(false);
  });

  it("rejects past date_time", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      date_time: pastIso(),
    });
    expect(r.success).toBe(false);
  });

  it("rejects date_time more than 3650 days out", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      date_time: futureIso(3651),
    });
    expect(r.success).toBe(false);
  });

  it("rejects cart_items array > 50", () => {
    const cart = Array.from({ length: 51 }, () => ({
      name: "Item",
      quantity: 1,
      unit_price: 10,
    }));
    const r = BookingInputSchema.safeParse({ ...okBooking(), cart_items: cart });
    expect(r.success).toBe(false);
  });

  it("rejects negative unit_price", () => {
    const r = BookingInputSchema.safeParse({
      ...okBooking(),
      cart_items: [{ name: "x", quantity: 1, unit_price: -1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("ModifyReservationSchema", () => {
  const ok = {
    reservation_id: "11111111-1111-4111-8111-111111111111",
    date: "2030-12-01",
    time: "19:30",
    party_size: 4,
  };

  it("accepts a valid payload", () => {
    expect(ModifyReservationSchema.safeParse(ok).success).toBe(true);
  });

  it("accepts 12h time format", () => {
    expect(
      ModifyReservationSchema.safeParse({ ...ok, time: "7:30 pm" }).success,
    ).toBe(true);
  });

  it("rejects oversized special_request", () => {
    expect(
      ModifyReservationSchema.safeParse({
        ...ok,
        special_request: "x".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("rejects bad date format", () => {
    expect(
      ModifyReservationSchema.safeParse({ ...ok, date: "2026/12/01" }).success,
    ).toBe(false);
  });

  it("accepts hyphenated confirmation codes like SEAT-AB12", () => {
    expect(
      ModifyReservationSchema.safeParse({ ...ok, confirmation_code: "SEAT-AB12" })
        .success,
    ).toBe(true);
  });

  it("accepts other prefixed codes like CEN-1A2B", () => {
    expect(
      ModifyReservationSchema.safeParse({ ...ok, confirmation_code: "CEN-1A2B" })
        .success,
    ).toBe(true);
  });
});

describe("PrepareDepositInputSchema", () => {
  const okPayer = {
    full_name: "Mark Habbi",
    email: "mark@example.com",
    amount_cents: 5000,
  };

  it("accepts 1-50 payers", () => {
    const r = PrepareDepositInputSchema.safeParse({
      reservation_id: "11111111-1111-4111-8111-111111111111",
      payers: [okPayer],
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty payers array", () => {
    const r = PrepareDepositInputSchema.safeParse({
      reservation_id: "11111111-1111-4111-8111-111111111111",
      payers: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects >50 payers", () => {
    const r = PrepareDepositInputSchema.safeParse({
      reservation_id: "11111111-1111-4111-8111-111111111111",
      payers: Array.from({ length: 51 }, () => okPayer),
    });
    expect(r.success).toBe(false);
  });

  it("rejects negative amount_cents", () => {
    const r = PrepareDepositInputSchema.safeParse({
      reservation_id: "11111111-1111-4111-8111-111111111111",
      payers: [{ ...okPayer, amount_cents: -1 }],
    });
    expect(r.success).toBe(false);
  });
});

describe("OrderTipSchema", () => {
  const orderId = "11111111-1111-4111-8111-111111111111";

  it("accepts tip_amount alone", () => {
    expect(
      OrderTipSchema.safeParse({ order_id: orderId, tip_amount: 5 }).success,
    ).toBe(true);
  });

  it("accepts tip_percentage alone", () => {
    expect(
      OrderTipSchema.safeParse({ order_id: orderId, tip_percentage: 18 })
        .success,
    ).toBe(true);
  });

  it("rejects both tip_amount and tip_percentage", () => {
    expect(
      OrderTipSchema.safeParse({
        order_id: orderId,
        tip_amount: 5,
        tip_percentage: 18,
      }).success,
    ).toBe(false);
  });

  it("accepts neither tip_amount nor tip_percentage (zero tip)", () => {
    expect(OrderTipSchema.safeParse({ order_id: orderId }).success).toBe(true);
  });

  it("rejects tip_percentage > 40", () => {
    expect(
      OrderTipSchema.safeParse({ order_id: orderId, tip_percentage: 41 })
        .success,
    ).toBe(false);
  });

  it("rejects negative tip_percentage", () => {
    expect(
      OrderTipSchema.safeParse({ order_id: orderId, tip_percentage: -1 })
        .success,
    ).toBe(false);
  });
});

describe("OrchestrateTranscriptSchema", () => {
  it("accepts a normal transcript", () => {
    expect(
      OrchestrateTranscriptSchema.safeParse({ transcript: "book me a table" })
        .success,
    ).toBe(true);
  });

  it("accepts exactly TRANSCRIPT_MAX_CHARS", () => {
    expect(
      OrchestrateTranscriptSchema.safeParse({
        transcript: "a".repeat(TRANSCRIPT_MAX_CHARS),
      }).success,
    ).toBe(true);
  });

  it("rejects TRANSCRIPT_MAX_CHARS + 1", () => {
    expect(
      OrchestrateTranscriptSchema.safeParse({
        transcript: "a".repeat(TRANSCRIPT_MAX_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects empty transcript", () => {
    expect(
      OrchestrateTranscriptSchema.safeParse({ transcript: "" }).success,
    ).toBe(false);
  });
});

describe("RestaurantOnboardingSchema", () => {
  it("accepts minimal valid payload", () => {
    expect(
      RestaurantOnboardingSchema.safeParse({ restaurant_name: "STK Toronto" })
        .success,
    ).toBe(true);
  });

  it("rejects oversized restaurant_name", () => {
    expect(
      RestaurantOnboardingSchema.safeParse({
        restaurant_name: "x".repeat(121),
      }).success,
    ).toBe(false);
  });

  it("rejects oversized description", () => {
    expect(
      RestaurantOnboardingSchema.safeParse({
        restaurant_name: "STK",
        description: "x".repeat(2001),
      }).success,
    ).toBe(false);
  });

  it("rejects lat out of range", () => {
    expect(
      RestaurantOnboardingSchema.safeParse({
        restaurant_name: "STK",
        lat: 91,
      }).success,
    ).toBe(false);
  });
});

describe("MenuItemSchema", () => {
  it("accepts minimal valid item", () => {
    expect(
      MenuItemSchema.safeParse({ name: "Burger", price: 18.5 }).success,
    ).toBe(true);
  });

  it("rejects negative price", () => {
    expect(
      MenuItemSchema.safeParse({ name: "Burger", price: -1 }).success,
    ).toBe(false);
  });

  it("rejects price > 10000", () => {
    expect(
      MenuItemSchema.safeParse({ name: "Burger", price: 10001 }).success,
    ).toBe(false);
  });

  it("rejects bad photo_url", () => {
    expect(
      MenuItemSchema.safeParse({
        name: "Burger",
        price: 10,
        photo_url: "not a url",
      }).success,
    ).toBe(false);
  });
});

describe("StaffInviteSchema", () => {
  it("accepts valid invite", () => {
    expect(
      StaffInviteSchema.safeParse({
        restaurant_id: "11111111-1111-4111-8111-111111111111",
        email: "host@example.com",
        role: "host",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown role", () => {
    expect(
      StaffInviteSchema.safeParse({
        restaurant_id: "11111111-1111-4111-8111-111111111111",
        email: "x@example.com",
        role: "ceo",
      }).success,
    ).toBe(false);
  });

  it("rejects hourly_rate > 1000", () => {
    expect(
      StaffInviteSchema.safeParse({
        restaurant_id: "11111111-1111-4111-8111-111111111111",
        email: "x@example.com",
        role: "manager",
        hourly_rate: 1001,
      }).success,
    ).toBe(false);
  });
});

describe("ProfileUpdateSchema", () => {
  it("accepts a valid profile patch", () => {
    expect(
      ProfileUpdateSchema.safeParse({
        full_name: "Mark Habbi",
        email: "mark@example.com",
        phone: "+14165551234",
      }).success,
    ).toBe(true);
  });

  it("rejects dietary_restrictions array > 50", () => {
    expect(
      ProfileUpdateSchema.safeParse({
        dietary_restrictions: Array.from({ length: 51 }, () => "vegan"),
      }).success,
    ).toBe(false);
  });
});

describe("HoursJsonSchema", () => {
  it("accepts valid hours", () => {
    expect(
      HoursJsonSchema.safeParse({
        mon: [{ open: "11:00", close: "22:00" }],
        tue: [{ open: "11:00", close: "22:00" }],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed time", () => {
    expect(
      HoursJsonSchema.safeParse({
        mon: [{ open: "11", close: "22:00" }],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown day key", () => {
    expect(
      HoursJsonSchema.safeParse({
        funday: [{ open: "11:00", close: "22:00" }],
      }).success,
    ).toBe(false);
  });
});

/// <reference types="vite/client" />
import { expect, test } from "vitest";
import {
  ladigitalBase,
  ladigitalAvailabilityUrl,
  ladigitalBookingUrl,
  ladigitalLeadsUrl,
  parseLadigitalSlots,
  ladigitalBookingBody,
  ladigitalBookingOk,
  ladigitalLeadBody,
} from "./lib/providers/ladigital";

// Pure adapter tests — the substance of the connector is translating between
// Omnivo's internal shapes and LA Digital's /api/agent contract. The shared
// fetch/dispatch plumbing is proven end-to-end by the webhook provider test.

test("ladigitalBase normalizes + validates the site URL", () => {
  expect(ladigitalBase({ baseUrl: "https://acme.ladigital.ca/" })).toBe(
    "https://acme.ladigital.ca",
  );
  expect(ladigitalBase({ baseUrl: "  https://acme.ladigital.ca  " })).toBe(
    "https://acme.ladigital.ca",
  );
  expect(ladigitalBase({})).toBeNull();
  expect(ladigitalBase({ baseUrl: "not a url" })).toBeNull();
  expect(ladigitalBase({ baseUrl: "ftp://x.com" })).toBeNull();
});

test("endpoint URLs derive from the base", () => {
  const c = { baseUrl: "https://acme.ladigital.ca" };
  expect(ladigitalAvailabilityUrl(c)).toBe(
    "https://acme.ladigital.ca/api/agent/availability",
  );
  expect(ladigitalBookingUrl(c)).toBe(
    "https://acme.ladigital.ca/api/agent/bookings",
  );
  expect(ladigitalLeadsUrl(c)).toBe(
    "https://acme.ladigital.ca/api/agent/leads",
  );
  expect(ladigitalAvailabilityUrl({})).toBeNull();
});

test("parseLadigitalSlots flattens days[].slots[].startUtc → sorted ms", () => {
  const t1 = 1_800_000_000_000;
  const t2 = t1 + 3_600_000;
  const t3 = t2 + 3_600_000;
  const json = {
    ok: true,
    days: [
      { slots: [{ startUtc: t2, endUtc: t2 + 1, label: "b" }, { startUtc: t3 }] },
      { slots: [{ startUtc: t1 }] },
    ],
  };
  expect(parseLadigitalSlots(json)).toEqual([t1, t2, t3]);
  // Defensive fallbacks: top-level slots, ISO strings, and empties.
  expect(parseLadigitalSlots({ slots: [{ start: t1 }] })).toEqual([t1]);
  expect(
    parseLadigitalSlots({ days: [{ slots: [{ startUtc: new Date(t1).toISOString() }] }] }),
  ).toEqual([t1]);
  expect(parseLadigitalSlots({})).toEqual([]);
  expect(parseLadigitalSlots(null)).toEqual([]);
});

test("ladigitalBookingBody is the flat name/email/startUtc shape", () => {
  expect(
    ladigitalBookingBody({
      startMs: 123,
      customerName: "Ada",
      customerEmail: "a@x.com",
      customerPhone: "555",
    }),
  ).toEqual({ name: "Ada", email: "a@x.com", startUtc: 123, phone: "555" });
});

test("ladigitalBookingOk requires 2xx and not { ok:false }", () => {
  expect(ladigitalBookingOk(200, { ok: true, manageToken: "t" })).toBe(true);
  expect(ladigitalBookingOk(201, {})).toBe(true);
  expect(ladigitalBookingOk(200, { ok: false })).toBe(false);
  expect(ladigitalBookingOk(500, { ok: true })).toBe(false);
  expect(ladigitalBookingOk(409, null)).toBe(false);
});

test("ladigitalLeadBody maps a lead.created event to the flat CRM shape", () => {
  expect(
    ladigitalLeadBody({
      name: "Ada",
      email: "a@x.com",
      phone: "555",
      message: "hi there",
    }),
  ).toMatchObject({
    name: "Ada",
    email: "a@x.com",
    phone: "555",
    notes: "hi there",
  });
  // `name` is required by /api/agent/leads — default rather than omit.
  expect(ladigitalLeadBody({ email: "a@x.com" })).toMatchObject({
    name: "Unknown",
    email: "a@x.com",
  });
});

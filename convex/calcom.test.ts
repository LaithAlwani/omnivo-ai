/// <reference types="vite/client" />
import { expect, test } from "vitest";
import {
  calcomSlotsUrl,
  parseCalcomSlots,
  calcomBookingBody,
  calcomBookingOk,
} from "./lib/providers/calcom";

// Pure Cal.com adapter — request shaping + defensive response parsing.

test("calcom — slots URL carries eventTypeId + window; null without event type", () => {
  const from = Date.UTC(2030, 0, 1, 0, 0, 0);
  const url = calcomSlotsUrl({ eventTypeId: 123, timeZone: "UTC" }, { fromMs: from, days: 7 });
  expect(url).toContain("eventTypeId=123");
  expect(url).toContain("start=2030-01-01");
  expect(url).toContain("timeZone=UTC");
  expect(calcomSlotsUrl({}, { fromMs: from, days: 7 })).toBeNull();
});

test("calcom — parseSlots tolerates date-keyed objects, arrays, {start}/{time}/string", () => {
  const a = "2030-01-01T09:00:00.000Z";
  const b = "2030-01-01T10:00:00.000Z";
  expect(parseCalcomSlots({ data: { "2030-01-01": [{ start: a }] } })).toEqual([Date.parse(a)]);
  expect(parseCalcomSlots({ data: [{ time: a }] })).toEqual([Date.parse(a)]);
  expect(parseCalcomSlots({ data: [a] })).toEqual([Date.parse(a)]);
  expect(parseCalcomSlots({ data: {} })).toEqual([]);
  // Sorted ascending across dates.
  expect(
    parseCalcomSlots({ data: { d: [{ start: b }, { start: a }] } }),
  ).toEqual([Date.parse(a), Date.parse(b)]);
});

test("calcom — booking body shapes the attendee + coerces id; null without event type", () => {
  const body = calcomBookingBody(
    { startMs: Date.parse("2030-01-01T09:00:00Z"), customerName: "Ada", customerEmail: "ada@x.com" },
    { eventTypeId: "123", timeZone: "UTC" },
  );
  expect(body).toMatchObject({
    eventTypeId: 123,
    attendee: { name: "Ada", email: "ada@x.com", timeZone: "UTC" },
  });
  expect(
    calcomBookingBody({ startMs: 0, customerName: "A", customerEmail: "a@x.com" }, {}),
  ).toBeNull();
});

test("calcom — bookingOk requires 2xx and a non-error status", () => {
  expect(calcomBookingOk(201, { status: "success", data: {} })).toBe(true);
  expect(calcomBookingOk(200, {})).toBe(true);
  expect(calcomBookingOk(400, { status: "error" })).toBe(false);
  expect(calcomBookingOk(200, { status: "error" })).toBe(false);
});

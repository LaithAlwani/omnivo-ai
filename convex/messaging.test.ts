/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  resolveSmsSettings,
  inQuietHours,
  DEFAULT_SMS_SETTINGS,
} from "./lib/smsSettings";

const modules = import.meta.glob("./**/*.ts");

// Pure settings resolution + clamping.
test("resolveSmsSettings — defaults, clamps, and validates quiet hours", () => {
  expect(resolveSmsSettings(undefined)).toEqual(DEFAULT_SMS_SETTINGS);

  // Lead hours clamp to 1..168.
  expect(resolveSmsSettings({ reminderLeadHours: 0 }).reminderLeadHours).toBe(1);
  expect(resolveSmsSettings({ reminderLeadHours: 9999 }).reminderLeadHours).toBe(168);

  // Quiet hours need two distinct valid endpoints, else disabled.
  expect(resolveSmsSettings({ quietStart: 21, quietEnd: 21 }).quietStart).toBeNull();
  expect(resolveSmsSettings({ quietStart: 21, quietEnd: null }).quietStart).toBeNull();
  const ok = resolveSmsSettings({ quietStart: 21, quietEnd: 8 });
  expect([ok.quietStart, ok.quietEnd]).toEqual([21, 8]);
});

// Quiet-hours window, including the overnight wrap.
test("inQuietHours — same-day and overnight ranges", () => {
  const overnight = resolveSmsSettings({ quietStart: 21, quietEnd: 8 });
  const at = (h: number) => Date.UTC(2026, 7, 3, h, 0, 0);
  expect(inQuietHours(at(23), "UTC", overnight)).toBe(true); // 11pm
  expect(inQuietHours(at(3), "UTC", overnight)).toBe(true); // 3am
  expect(inQuietHours(at(10), "UTC", overnight)).toBe(false); // 10am

  const daytime = resolveSmsSettings({ quietStart: 12, quietEnd: 14 });
  expect(inQuietHours(at(13), "UTC", daytime)).toBe(true);
  expect(inQuietHours(at(15), "UTC", daytime)).toBe(false);

  // Disabled → never quiet.
  expect(inQuietHours(at(3), "UTC", DEFAULT_SMS_SETTINGS)).toBe(false);
});

async function professionalWithCompletedBooking(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) => ctx.db.insert("users", { email: "o@x.com" }));
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "professional",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });
  const now = Date.now();
  await t.run(async (ctx) => {
    const staff = (
      await ctx.db
        .query("staff")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    )[0];
    await ctx.db.insert("bookings", {
      businessId,
      staffId: staff._id,
      locationId: staff.locationId,
      start: now - 2 * 60 * 60 * 1000,
      end: now - 60 * 60 * 1000,
      status: "confirmed" as const,
      customerName: "Casey",
      customerEmail: "casey@x.com",
      customerPhone: "+15551234567",
      cancelToken: "t",
      source: "assistant" as const,
    });
  });
  return { as, businessId };
}

// The review-request SMS toggle steers the channel: off → email even with a
// phone number and the SMS module on.
test("review channel respects the SMS review-request toggle", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await professionalWithCompletedBooking(t);

  // Default settings → SMS (module on + phone present).
  await t.mutation(internal.reviews.requestForBusiness, { businessId });
  let channel = (await t.run((ctx) =>
    ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .first(),
  ))!.channel;
  expect(channel).toBe("sms");

  // Turn the SMS review toggle off, on a fresh completed booking.
  await as.mutation(api.messaging.updateSettings, {
    slug: "clip",
    settings: {
      ...DEFAULT_SMS_SETTINGS,
      reviewRequestEnabled: false,
    },
  });
  const now = Date.now();
  const b2 = await t.run(async (ctx) => {
    const staff = (
      await ctx.db
        .query("staff")
        .withIndex("by_business", (q) => q.eq("businessId", businessId))
        .collect()
    )[0];
    return await ctx.db.insert("bookings", {
      businessId,
      staffId: staff._id,
      locationId: staff.locationId,
      start: now - 2 * 60 * 60 * 1000,
      end: now - 60 * 60 * 1000,
      status: "confirmed" as const,
      customerName: "Dana",
      customerEmail: "dana@x.com",
      customerPhone: "+15559876543",
      cancelToken: "t2",
      source: "assistant" as const,
    });
  });
  await t.mutation(internal.reviews.requestForBusiness, { businessId });
  channel = (await t.run((ctx) => ctx.db.get(b2 as Id<"bookings">)))
    ? (await t.run((ctx) =>
        ctx.db
          .query("reviewRequests")
          .withIndex("by_booking", (q) => q.eq("bookingId", b2 as Id<"bookings">))
          .first(),
      ))!.channel
    : "sms";
  expect(channel).toBe("email");
});

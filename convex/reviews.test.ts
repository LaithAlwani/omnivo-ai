/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function projectWithCompletedBooking(t: TestConvex<typeof schema>) {
  const owner = await t.run((ctx) =>
    ctx.db.insert("users", { email: "o@x.com" }),
  );
  const as = t.withIdentity({ subject: `${owner}|s` });
  const businessId = await as.mutation(internal.businesses.provision, {
    name: "Clip",
    slug: "clip",
    tier: "professional",
    embedKeyPrefix: "pp",
    embedKeyHash: "hh",
    embedKey: "ek_pp.x",
  });

  // A booking that finished an hour ago.
  const now = Date.now();
  const bookingId = await t.run(async (ctx) => {
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
      customerName: "Casey",
      customerEmail: "casey@x.com",
      cancelToken: "t",
      source: "assistant" as const,
    });
  });

  return { t, as, businessId, bookingId: bookingId as Id<"bookings"> };
}

// The cron claims a completed booking and creates exactly one review request.
test("review workflow — a completed booking gets one request, idempotently", async () => {
  const t = convexTest(schema, modules);
  const { businessId, bookingId } = await projectWithCompletedBooking(t);

  await t.mutation(internal.reviews.requestForBusiness, { businessId });
  // A second tick must not create a duplicate (claimed via reviewRequestSentAt).
  await t.mutation(internal.reviews.requestForBusiness, { businessId });

  const requests = await t.run((ctx) =>
    ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect(),
  );
  expect(requests).toHaveLength(1);
  // SMS Automation is on by default but there's no phone → email channel.
  expect(requests[0].channel).toBe("email");

  const booking = await t.run((ctx) => ctx.db.get(bookingId));
  expect(booking?.reviewRequestSentAt).toBeTruthy();
});

// Positive → returns the business review link; negative → stores feedback +
// logs an owner alert.
test("review response — positive returns the link, negative captures feedback", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await projectWithCompletedBooking(t);
  await as.mutation(api.reviews.setReviewLink, {
    slug: "clip",
    reviewLink: "https://g.page/clip/review",
  });
  await t.mutation(internal.reviews.requestForBusiness, { businessId });

  const token = (await t.run((ctx) =>
    ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .first(),
  ))!.token;

  // Positive path.
  const res = await t.mutation(api.reviews.respond, {
    token,
    sentiment: "positive",
    rating: 5,
  });
  expect(res.reviewLink).toBe("https://g.page/clip/review");

  // Metrics reflect the response.
  const m1 = await as.query(api.reviews.metrics, { slug: "clip" });
  expect(m1.responses).toBe(1);
  expect(m1.positive).toBe(1);
  expect(m1.avgRating).toBe(5);

  // Negative path (re-respond) captures feedback + writes an audit-log alert.
  await t.mutation(api.reviews.respond, {
    token,
    sentiment: "negative",
    rating: 2,
    feedback: "Long wait.",
  });
  const m2 = await as.query(api.reviews.metrics, { slug: "clip" });
  expect(m2.negative).toBe(1);
  expect(m2.recentNegative[0].feedback).toBe("Long wait.");

  const alerts = await t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .withIndex("by_business_ts", (q) => q.eq("businessId", businessId))
      .collect(),
  );
  expect(alerts.some((a) => a.action === "review.negative_feedback")).toBe(true);
});

// With Review Management off, the cron creates nothing.
test("review workflow — disabled module produces no requests", async () => {
  const t = convexTest(schema, modules);
  const { as, businessId } = await projectWithCompletedBooking(t);
  await as.mutation(api.entitlements.setModule, {
    slug: "clip",
    module: "reviewManagement",
    enabled: false,
  });

  await t.mutation(internal.reviews.enqueueReviewRequests, {});

  const requests = await t.run((ctx) =>
    ctx.db
      .query("reviewRequests")
      .withIndex("by_business", (q) => q.eq("businessId", businessId))
      .collect(),
  );
  expect(requests).toHaveLength(0);
});

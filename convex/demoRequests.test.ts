/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t, "rateLimiter");
  return t;
}

const valid = {
  name: "Jane Doe",
  email: "jane@business.com",
  subject: "Curious about booking",
  phone: "+1 555 0100",
  message: "We run a clinic and want the assistant to handle scheduling.",
};

test("demo request — a blank name is rejected", async () => {
  const t = setup();
  await expect(
    t.action(api.demoRequests.submit, { ...valid, name: "   " }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
});

test("demo request — a malformed email is rejected", async () => {
  const t = setup();
  await expect(
    t.action(api.demoRequests.submit, { ...valid, email: "not-an-email" }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
});

test("demo request — an over-long message is rejected", async () => {
  const t = setup();
  await expect(
    t.action(api.demoRequests.submit, {
      ...valid,
      message: "x".repeat(4001),
    }),
  ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
});

test("demo request — valid input clears validation and reaches the mailer", async () => {
  const t = setup();
  // SMTP isn't configured in tests, so the request passes every validation and
  // rate-limit gate and then fails at the email step with CONFIG — proving the
  // whole pipeline is wired through to sending.
  await expect(
    t.action(api.demoRequests.submit, valid),
  ).rejects.toMatchObject({ data: { code: "CONFIG" } });
});

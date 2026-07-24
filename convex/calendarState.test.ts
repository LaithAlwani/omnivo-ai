import { expect, test } from "vitest";
import { signState, verifyState } from "./lib/calendarState";

const SECRET = "test-secret";

test("oauth state — round-trips businessId + staffId + provider", async () => {
  const s = await signState(SECRET, "biz123", "staff456", "google");
  expect(await verifyState(SECRET, s)).toEqual({
    businessId: "biz123",
    staffId: "staff456",
    provider: "google",
  });
});

test("oauth state — carries the microsoft provider", async () => {
  const s = await signState(SECRET, "biz", "staff", "microsoft");
  expect(await verifyState(SECRET, s)).toMatchObject({ provider: "microsoft" });
});

test("oauth state — rejects tampering", async () => {
  const s = await signState(SECRET, "biz123", "staff456", "google");
  const tampered = s.replace("staff456", "staff999");
  expect(await verifyState(SECRET, tampered)).toBeNull();
});

test("oauth state — rejects a swapped provider", async () => {
  const s = await signState(SECRET, "biz", "staff", "google");
  const swapped = s.replace("~google~", "~microsoft~");
  expect(await verifyState(SECRET, swapped)).toBeNull();
});

test("oauth state — rejects a forged signature (wrong secret)", async () => {
  const s = await signState(SECRET, "biz", "staff", "google");
  expect(await verifyState("other-secret", s)).toBeNull();
});

test("oauth state — rejects expired", async () => {
  const s = await signState(SECRET, "biz", "staff", "google", -1000);
  expect(await verifyState(SECRET, s)).toBeNull();
});

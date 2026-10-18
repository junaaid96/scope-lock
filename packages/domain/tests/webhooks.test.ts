import { describe, expect, it } from "vitest";
import { ACTIONS, type Action } from "../src/policy.js";
import { isWebhookEvent, signWebhookPayload, verifyWebhookSignature, webhookTimestamp } from "../src/webhooks.js";

describe("ACTIONS", () => {
  it("lists every protected action exactly once", () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
    expect(ACTIONS).toContain("approval.decide");
    expect(ACTIONS).toContain("acceptance.send");
    const action: Action = "org.manage";
    expect(ACTIONS.includes(action)).toBe(true);
  });
});

describe("webhook signing", () => {
  const secret = "whsec_test";
  const timestamp = "1729790000";
  const body = JSON.stringify({ event: "approval.sent", id: "whe_1" });

  it("signs deterministically with the documented v1 scheme", () => {
    const sig = signWebhookPayload(secret, timestamp, body);
    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(signWebhookPayload(secret, timestamp, body)).toBe(sig);
  });

  it("verifies its own signatures and rejects tampering", () => {
    const sig = signWebhookPayload(secret, timestamp, body);
    expect(verifyWebhookSignature(secret, timestamp, body, sig)).toBe(true);
    expect(verifyWebhookSignature(secret, timestamp, `${body} `, sig)).toBe(false);
    expect(verifyWebhookSignature(secret, "1729790001", body, sig)).toBe(false);
    expect(verifyWebhookSignature("other", timestamp, body, sig)).toBe(false);
    expect(verifyWebhookSignature(secret, timestamp, body, "v1=deadbeef")).toBe(false);
  });

  it("emits unix-seconds timestamps", () => {
    expect(webhookTimestamp(new Date("2026-10-18T00:00:00.000Z"))).toBe(
      Math.floor(Date.parse("2026-10-18T00:00:00.000Z") / 1000).toString(),
    );
    expect(webhookTimestamp()).toMatch(/^\d{10}$/);
  });

  it("recognizes the event catalog", () => {
    expect(isWebhookEvent("approval.sent")).toBe(true);
    expect(isWebhookEvent("approval.decided")).toBe(true);
    expect(isWebhookEvent("approval.expired")).toBe(true);
    expect(isWebhookEvent("approval.escalated")).toBe(true);
    expect(isWebhookEvent("acceptance.deemed")).toBe(true);
    expect(isWebhookEvent("change.deleted")).toBe(false);
  });
});

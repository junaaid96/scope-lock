import { describe, expect, it } from "vitest";
import { escalationAfterHours, escalationTarget, isEscalationDue } from "../src/escalation.js";

describe("escalationAfterHours", () => {
  it("accepts 1–720 hours and rejects anything else", () => {
    expect(escalationAfterHours({ escalation: { afterHours: 24 } })).toBe(24);
    expect(escalationAfterHours({ escalation: { afterHours: 1 } })).toBe(1);
    expect(escalationAfterHours({ escalation: { afterHours: 720 } })).toBe(720);
    expect(escalationAfterHours({})).toBe(null);
    expect(escalationAfterHours({ escalation: null })).toBe(null);
    expect(escalationAfterHours({ escalation: { afterHours: null } })).toBe(null);
    expect(escalationAfterHours({ escalation: { afterHours: 0 } })).toBe(null);
    expect(escalationAfterHours({ escalation: { afterHours: 721 } })).toBe(null);
    expect(escalationAfterHours({ escalation: { afterHours: 1.5 } })).toBe(null);
  });
});

describe("escalationTarget", () => {
  it("defaults unknown targets to the agency lead", () => {
    expect(escalationTarget({ escalation: { target: "SECOND_APPROVER" } })).toBe("SECOND_APPROVER");
    expect(escalationTarget({ escalation: { target: "AGENCY_LEAD" } })).toBe("AGENCY_LEAD");
    expect(escalationTarget({})).toBe("AGENCY_LEAD");
    expect(escalationTarget({ escalation: { target: "SOMEONE_ELSE" } })).toBe("AGENCY_LEAD");
  });
});

describe("isEscalationDue", () => {
  const base = {
    status: "SENT",
    escalatedAt: null,
    sentAt: "2026-10-18T00:00:00.000Z",
    nowIso: "2026-10-19T01:00:00.000Z",
    settings: { escalation: { afterHours: 24 } },
  };
  it("is due for a stale, never-escalated SENT package", () => {
    expect(isEscalationDue(base)).toBe(true);
  });
  it("is not due when fresh, decided, already escalated, dateless, or disabled", () => {
    expect(isEscalationDue({ ...base, nowIso: "2026-10-18T23:00:00.000Z" })).toBe(false);
    expect(isEscalationDue({ ...base, status: "DECIDED" })).toBe(false);
    expect(isEscalationDue({ ...base, escalatedAt: "2026-10-19T00:00:00.000Z" })).toBe(false);
    expect(isEscalationDue({ ...base, sentAt: null })).toBe(false);
    expect(isEscalationDue({ ...base, settings: {} })).toBe(false);
  });
});

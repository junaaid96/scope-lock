import { describe, expect, it } from "vitest";
import { can, type AccessContext } from "../src/policy.js";

const lead: AccessContext = { orgRole: "MEMBER", projectRole: "LEAD" };
const admin: AccessContext = { orgRole: "ADMIN", projectRole: null };
const clientApprover: AccessContext = { orgRole: "CLIENT", projectRole: "CLIENT_APPROVER" };
const clientViewer: AccessContext = { orgRole: "CLIENT", projectRole: "CLIENT_VIEWER" };
const outsider: AccessContext = { orgRole: "MEMBER", projectRole: null };

describe("policy", () => {
  it("lets leads run the agency workflow", () => {
    for (const a of [
      "scope.draft",
      "scope.publish",
      "change.triage",
      "change.estimate",
      "change.send",
      "change.implement",
      "bundle.manage",
    ] as const) {
      expect(can(lead, a)).toBe(true);
    }
  });

  it("lets org admins act on projects without explicit membership", () => {
    expect(can(admin, "scope.publish")).toBe(true);
    expect(can(admin, "project.view")).toBe(true);
  });

  it("denies project access without membership", () => {
    expect(can(outsider, "project.view")).toBe(false);
    expect(can(outsider, "scope.view")).toBe(false);
  });

  it("restricts clients to viewing, submitting, and assigned decisions", () => {
    expect(can(clientApprover, "change.submit")).toBe(true);
    expect(can(clientApprover, "approval.decide")).toBe(false);
    expect(can({ ...clientApprover, isAssignedApprover: true }, "approval.decide")).toBe(true);
    expect(can(clientApprover, "scope.publish")).toBe(false);
    expect(can(clientViewer, "change.submit")).toBe(false);
    expect(can(clientViewer, "project.view")).toBe(true);
  });

  it("denies everything without an org role", () => {
    expect(can({ orgRole: null, projectRole: "LEAD" }, "project.view")).toBe(false);
  });

  it("keeps rate cards with agency staff and management with admins", () => {
    expect(can({ orgRole: "OWNER", projectRole: null }, "ratecard.manage")).toBe(true);
    expect(can({ orgRole: "ADMIN", projectRole: null }, "ratecard.manage")).toBe(true);
    expect(can({ orgRole: "MEMBER", projectRole: null }, "ratecard.manage")).toBe(false);
    expect(can({ orgRole: "MEMBER", projectRole: null }, "ratecard.view")).toBe(true);
    expect(can(clientApprover, "ratecard.view")).toBe(false);
    expect(can(clientViewer, "ratecard.manage")).toBe(false);
    expect(can({ orgRole: null, projectRole: null }, "ratecard.view")).toBe(false);
  });
});

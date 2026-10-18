import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Response } from "superagent";
import { PDFDocument } from "pdf-lib";
import { agencyFixture, createTestApp, register, type Agent } from "./helpers.js";

const EXPIRY = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function sendableChange(agent: Agent, projectId: string): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Certified work",
    description: "Certified work description",
    source: "AGENCY",
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  let v = created.body.version as number;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const res = await agent.patch(`/api/v1/change-requests/${id}`).send({
      expectedVersion: v,
      status,
      ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
    });
    expect(res.status).toBe(200);
    v = res.body.version as number;
  }
  const impact = await agent.post(`/api/v1/change-requests/${id}/impact`).send({
    effortDays: 2,
    priceMinor: 50000,
    timelineDays: 3,
    confidence: "HIGH",
  });
  expect(impact.status).toBe(201);
  return id;
}

async function pdfBytes(res: Response): Promise<Buffer> {
  return res.body as Buffer;
}

function parseBinary(res: Response, cb: (err: Error | null, body: unknown) => void): void {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
}

describe("change order PDF + decision certificate", () => {
  it("serves a deterministic, well-formed PDF to approvers and staff", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;

    const first = await fx.owner.agent
      .get(`/api/v1/approval-requests/${approvalId}/pdf`)
      .buffer(true)
      .parse(parseBinary);
    expect(first.status).toBe(200);
    expect(first.headers["content-type"]).toMatch(/application\/pdf/);
    expect(first.headers["content-disposition"]).toMatch(/attachment; filename="change-order-.*\.pdf"/);
    const one = await pdfBytes(first);

    // Byte-identical on repeat: no timestamps, ids, or randomness.
    const second = await fx.owner.agent
      .get(`/api/v1/approval-requests/${approvalId}/pdf`)
      .buffer(true)
      .parse(parseBinary);
    expect((await pdfBytes(second)).equals(one)).toBe(true);

    // The review-link holder gets the same bytes.
    const viaToken = await request(app)
      .get(`/api/v1/approval-requests/${token}/pdf`)
      .buffer(true)
      .parse(parseBinary);
    expect(viaToken.status).toBe(200);
    expect((await pdfBytes(viaToken)).equals(one)).toBe(true);

    // Well-formed: parses, has pages and a title.
    const doc = await PDFDocument.load(one);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getTitle()).toBeTruthy();

    // Strangers and unknown refs stay out.
    const stranger = await register(app, { email: "mallory@evil.test", organizationName: "Evil" });
    const snoop = await stranger.agent.get(`/api/v1/approval-requests/${approvalId}/pdf`);
    expect([401, 403, 404]).toContain(snoop.status);
    const ghost = await request(app).get("/api/v1/approval-requests/does-not-exist/pdf");
    expect(ghost.status).toBe(404);
  });

  it("refuses PDFs for invalidated packages", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: (detail.body as { version: number }).version,
      description: "v2 invalidates the package",
    });
    const pdf = await fx.owner.agent.get(`/api/v1/approval-requests/${approvalId}/pdf`);
    expect(pdf.status).toBe(409);
  });

  it("verifies checksums publicly and detects tampering", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      comment: "Yes",
      confirm: true,
    });
    expect(decide.status).toBe(201);

    // No session: the verify page data is public but minimal.
    const ok = await request(app).get(`/api/v1/verify/${approvalId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.match).toBe(true);
    expect(ok.body.recomputedChecksum).toBe(ok.body.approval.checksum);
    expect(ok.body.decisions).toHaveLength(1);
    const leaked = JSON.stringify(ok.body);
    expect(leaked).not.toContain(fx.organizationId);
    expect(leaked).not.toContain(fx.projectId);
    expect(leaked).not.toContain(fx.clientUserId);

    // Tamper with the stored bytes: recompute diverges, page reports mismatch.
    const approval = await store.findApprovalById(approvalId);
    await store.updateApproval(approvalId, {
      package: { ...approval!.package, title: "Forged title" },
    });
    const bad = await request(app).get(`/api/v1/verify/${approvalId}`);
    expect(bad.status).toBe(200);
    expect(bad.body.match).toBe(false);
    expect(bad.body.recomputedChecksum).not.toBe(bad.body.approval.checksum);

    const ghost = await request(app).get("/api/v1/verify/apr_doesnotexist000");
    expect(ghost.status).toBe(404);
  });
});

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { drainOnce } from "../src/lib/worker.js";
import { agencyFixture, createTestApp, draftScope } from "./helpers.js";

describe("files, health, worker, idempotency", () => {
  it("uploads bytes through signed intents and downloads via short-lived URLs", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const bytes = Buffer.from("proposal contents");
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const intent = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/uploads/intents`).send({
      fileName: "proposal.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      checksumSha256: checksum,
    });
    expect(intent.status).toBe(201);
    const { attachmentId, uploadUrl } = intent.body as { attachmentId: string; uploadUrl: string };
    const localPath = new URL(uploadUrl).pathname + new URL(uploadUrl).search;
    const put = await request(app).put(localPath).set("Content-Type", "application/pdf").send(bytes);
    expect(put.status).toBe(200);
    expect(put.body.checksumSha256).toBe(checksum);
    const complete = await fx.owner.agent.post(`/api/v1/attachments/${attachmentId}/complete`).send({});
    expect(complete.status).toBe(200);
    expect(complete.body.status).toBe("READY");

    const dl = await fx.owner.agent.get(`/api/v1/attachments/${attachmentId}/download-url`);
    expect(dl.status).toBe(200);
    const dlPath = new URL((dl.body as { downloadUrl: string }).downloadUrl).pathname +
      new URL((dl.body as { downloadUrl: string }).downloadUrl).search;
    const get = await request(app).get(dlPath);
    expect(get.status).toBe(200);

    // Tampered signatures fail closed.
    const tampered = await request(app).get(dlPath.replace(/sig=[^&]+/, "sig=deadbeef"));
    expect(tampered.status).toBe(403);

    // Rejected: wrong content type, oversize, checksum mismatch.
    const badType = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/uploads/intents`).send({
      fileName: "evil.exe",
      contentType: "application/x-msdownload",
      sizeBytes: 10,
      checksumSha256: checksum,
    });
    expect(badType.status).toBe(422);
    const big = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/uploads/intents`).send({
      fileName: "big.pdf",
      contentType: "application/pdf",
      sizeBytes: 11 * 1024 * 1024,
      checksumSha256: checksum,
    });
    expect(big.status).toBe(422);
    const mismatch = await fx.owner.agent.post(`/api/v1/attachments/${attachmentId}/complete`).send({
      checksumSha256: "0".repeat(64),
    });
    expect(mismatch.status).toBe(409); // already READY
    void mismatch;
  });

  it("quarantines uploads that fail the malware scan", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const upload = async (bytes: Buffer, fileName: string) => {
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const intent = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/uploads/intents`).send({
        fileName,
        contentType: "text/plain",
        sizeBytes: bytes.length,
        checksumSha256: checksum,
      });
      expect(intent.status).toBe(201);
      const { attachmentId, uploadUrl } = intent.body as { attachmentId: string; uploadUrl: string };
      const localPath = new URL(uploadUrl).pathname + new URL(uploadUrl).search;
      const put = await request(app).put(localPath).set("Content-Type", "text/plain").send(bytes);
      expect(put.status).toBe(200);
      return attachmentId;
    };
    // EICAR test signature is quarantined and never downloadable.
    // (Assembled from parts so this file does not itself match the signature.)
    const eicar = Buffer.from(["X5O!P%@AP[4", "\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join(""));
    const badId = await upload(eicar, "test.txt");
    const completeBad = await fx.owner.agent.post(`/api/v1/attachments/${badId}/complete`).send({});
    expect(completeBad.status).toBe(422);
    expect(JSON.stringify(completeBad.body)).toMatch(/quarantined/);
    expect((await fx.owner.agent.get(`/api/v1/attachments/${badId}/download-url`)).status).toBe(404);
    // Executable magic bytes are quarantined even with an innocent content type.
    const exe = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.from("not really text")]);
    const exeId = await upload(exe, "notes.txt");
    const completeExe = await fx.owner.agent.post(`/api/v1/attachments/${exeId}/complete`).send({});
    expect(completeExe.status).toBe(422);
    // Tampered bytes (checksum mismatch against stored bytes) are rejected.
    const good = Buffer.from("genuine proposal text");
    const goodChecksum = createHash("sha256").update(good).digest("hex");
    const intent = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/uploads/intents`).send({
      fileName: "proposal.txt",
      contentType: "text/plain",
      sizeBytes: good.length,
      checksumSha256: goodChecksum,
    });
    const tamperId = (intent.body as { attachmentId: string }).attachmentId;
    const tamperPath = new URL((intent.body as { uploadUrl: string }).uploadUrl);
    // Same byte length as declared, but different content.
    const tampered = Buffer.from("forged proposal text!");
    await request(app).put(tamperPath.pathname + tamperPath.search).set("Content-Type", "text/plain").send(tampered);
    const mismatch = await fx.owner.agent.post(`/api/v1/attachments/${tamperId}/complete`).send({});
    expect(mismatch.status).toBe(422);
  });

  it("expires abandoned upload intents via retention GC", async () => {
    const { app, ctx } = createTestApp();
    const fx = await agencyFixture(app);
    const bytes = Buffer.from("abandoned");
    const intent = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/uploads/intents`).send({
      fileName: "abandoned.pdf",
      contentType: "application/pdf",
      sizeBytes: bytes.length,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const attachmentId = (intent.body as { attachmentId: string }).attachmentId;
    // A fresh intent survives the drain even with a short TTL.
    await drainOnce({ store: ctx.store, env: { ...ctx.env, PENDING_UPLOAD_TTL_HOURS: 1 }, email: ctx.email, realtime: ctx.realtime, storage: ctx.storage });
    const before = await ctx.store.findAttachmentById(attachmentId);
    expect(before?.status).toBe("PENDING");
    // Backdate the intent past the 24h TTL, then drain again.
    const withOld = before as unknown as { createdAt: string };
    withOld.createdAt = new Date(Date.now() - 25 * 3_600_000).toISOString();
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime, storage: ctx.storage });
    const after = await ctx.store.findAttachmentById(attachmentId);
    expect(after?.status).toBe("DELETED");
    const events = await ctx.store.listAuditEvents({ projectId: fx.projectId, limit: 50 });
    expect(events.items.some((e) => e.action === "attachment.intent_expired")).toBe(true);
  });

  it("attaches and verifies delivery evidence", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const reqs = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/requirements`);
    const reqId = (reqs.body.data as Array<{ id: string }>)[0]?.id as string;
    const ev = await fx.owner.agent.post(`/api/v1/requirements/${reqId}/evidence`).send({
      type: "URL",
      title: "Staging demo",
      url: "https://staging.example/demo",
    });
    expect(ev.status).toBe(201);
    const verify = await fx.owner.agent.patch(`/api/v1/evidence/${ev.body.id as string}`).send({ status: "ACCEPTED" });
    expect(verify.body.status).toBe("ACCEPTED");
    // Client cannot verify evidence.
    const clientVerify = await fx.client.agent.patch(`/api/v1/evidence/${ev.body.id as string}`).send({ status: "REVIEWED" });
    expect(clientVerify.status).toBe(403);
    const list = await fx.owner.agent.get(`/api/v1/requirements/${reqId}/evidence`);
    expect(list.body.data).toHaveLength(1);
  });

  it("computes decision-quality, AI-review, and weekly-active metrics", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const empty = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/metrics`);
    expect(empty.body.approvedWithoutClarificationRate).toBeNull();
    expect(empty.body.aiSuggestionReview).toEqual({ total: 0, reviewed: 0, acceptRate: null });

    // One AI suggestion, reviewed as accepted.
    const ch = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "AI probe", description: "needs analysis", source: "AGENCY",
    });
    const chId = ch.body.id as string;
    const analysis = await fx.owner.agent.post(`/api/v1/change-requests/${chId}/ai/scope-analysis`).send({});
    expect(analysis.status).toBe(200);
    const review = await fx.owner.agent
      .patch(`/api/v1/projects/${fx.projectId}/ai/analyses/${(analysis.body as { analysis: { id: string } }).analysis.id}`)
      .send({ disposition: "ACCEPTED" });
    expect(review.status).toBe(200);

    // Approve two changes: one with zero Q&A rounds, one with a clarification.
    const approve = async (title: string, withClarification: boolean): Promise<void> => {
      const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
        title, description: `${title} desc`, source: "AGENCY",
      });
      const id = created.body.id as string;
      let v = created.body.version as number;
      for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
        const res = await fx.owner.agent.patch(`/api/v1/change-requests/${id}`).send({ expectedVersion: v, status });
        v = res.body.version as number;
      }
      if (withClarification) {
        const q = await fx.owner.agent.post(`/api/v1/change-requests/${id}/clarifications`).send({ question: "Which pages?" });
        await fx.client.agent.post(`/api/v1/change-requests/${id}/clarifications/${q.body.id as string}/answer`).send({ answer: "All" });
      }
      await fx.owner.agent.post(`/api/v1/change-requests/${id}/impact`).send({ effortDays: 1, priceMinor: 1000, confidence: "LOW" });
      const sent = await fx.owner.agent.post(`/api/v1/change-requests/${id}/approval-requests`).send({
        approverUserIds: [fx.clientUserId],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      const token = ((sent.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
      await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", confirm: true });
    };
    await approve("Clean approval", false);
    await approve("Discussed approval", true);

    const m = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/metrics`);
    expect(m.body.approvedWithoutClarificationRate).toBe(0.5);
    expect(m.body.aiSuggestionReview).toEqual({ total: 1, reviewed: 1, acceptRate: 1 });

    const org = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/metrics`);
    expect(org.body.projectCount).toBe(1);
    expect(org.body.weeklyActiveProjects).toBe(1);
    expect((await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/metrics`)).status).toBe(403);
  });

  it("explains scope health and records metrics", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Unlinked", description: "no links yet", source: "AGENCY",
    });
    const health = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/health`);
    expect(health.status).toBe(200);
    expect(health.body.signals).toHaveLength(5);
    expect(health.body.signals.every((s: { detail: string }) => s.detail.length > 0)).toBe(true);
    const unlinked = health.body.signals.find((s: { key: string }) => s.key === "unlinked");
    expect(unlinked.count).toBe(1);
    const metrics = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.eventCounts["change.submitted"]).toBe(1);
  });

  it("exports a portable change summary", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Export me", description: "desc", source: "AGENCY",
    });
    const exported = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/export/change/${created.body.id as string}`);
    expect(exported.status).toBe(200);
    expect(exported.body.change.number).toMatch(/^CHG-/);
    expect(exported.body.project.name).toBeTruthy();
  });

  it("delivers outbox mail, expires approvals, and sends reminders", async () => {
    const { app, ctx } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Waiting", description: "d", source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 1, confidence: "LOW" });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(send.status).toBe(201);
    const approvalId = (send.body.approval as { id: string }).id;

    // Reminder pass: expiry within 48h triggers the first reminder.
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    const afterReminder = await ctx.store.findApprovalById(approvalId);
    expect(afterReminder?.remindersSent).toContain(48);
    const clientNotifs = await ctx.store.listNotifications(fx.clientUserId, {});
    expect(clientNotifs.items.some((n) => n.type === "APPROVAL_REMINDER")).toBe(true);

    // Force expiry, then drain again (expiry notices enqueue during the deadline
    // pass, so one final drain delivers them — same as the next worker tick).
    await ctx.store.updateApproval(approvalId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect((await ctx.store.findApprovalById(approvalId))?.status).toBe("EXPIRED");
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    const outbox = await ctx.store.claimOutboxBatch(100, new Date(Date.now() + 3600_000).toISOString());
    // Everything due was delivered; nothing remains claimable.
    expect(outbox).toHaveLength(0);
    void v;
  });

  it("replays idempotent sends and serves realtime tokens + event polling", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Idem", description: "d", source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 1, confidence: "LOW" });
    const payload = { approverUserIds: [fx.clientUserId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
    const first = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).set("Idempotency-Key", "k-1").send(payload);
    expect(first.status).toBe(201);
    const replay = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).set("Idempotency-Key", "k-1").send(payload);
    expect(replay.status).toBe(201);
    expect(replay.headers["idempotency-replayed"]).toBe("true");
    expect(replay.body.approval.id).toBe(first.body.approval.id);
    // Without the key, re-sending while SENT is blocked.
    const dup = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send(payload);
    expect(dup.status).toBe(422);

    const token = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/realtime/token`);
    expect(token.status).toBe(200);
    expect(token.body.channel).toBe(`project:${fx.projectId}`);
    const events = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/events`);
    expect(events.status).toBe(200);
    expect(events.body.events.length).toBeGreaterThan(0);
    void v;
  });

  it("applies organization branding to client review pages", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const brand = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}`).send({
      branding: { displayName: "Acme Studio", logoUrl: "https://cdn.example/logo.png", primaryColor: "#123456" },
    });
    expect(brand.status).toBe(200);
    const badColor = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}`).send({
      branding: { displayName: "x", primaryColor: "not-a-color" },
    });
    expect(badColor.status).toBe(400);

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Brand check", description: "d", source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 1, confidence: "LOW" });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const review = await request(app).get(`/api/v1/approval-requests/${token}`);
    expect(review.body.branding.displayName).toBe("Acme Studio");
    expect(review.body.organizationName).toBe("Agency");
    void v;
  });

  it("gates external integrations behind an explicit opt-in", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Ext", description: "d", source: "AGENCY",
    });
    const blocked = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-links`).send({
      changeRequestId: created.body.id,
      provider: "JIRA",
      externalId: "PROJ-1",
    });
    expect(blocked.status).toBe(422);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ externalIntegrationsEnabled: true });
    const linked = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-links`).send({
      changeRequestId: created.body.id,
      provider: "JIRA",
      externalId: "PROJ-1",
      url: "https://jira.example/PROJ-1",
    });
    expect(linked.status).toBe(201);
    const dup = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-links`).send({
      changeRequestId: created.body.id,
      provider: "JIRA",
      externalId: "PROJ-1",
    });
    expect(dup.status).toBe(409);
    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/external-links`);
    expect(list.body.data).toHaveLength(1);
    const del = await fx.owner.agent.delete(`/api/v1/external-links/${linked.body.id as string}`);
    expect(del.status).toBe(200);
  });
});

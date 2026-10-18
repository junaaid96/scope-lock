import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app-context.js";
import { getEnv, resetEnvCache } from "../src/env.js";
import { createEmailDriver } from "../src/lib/email.js";
import { createRealtimeDriver } from "../src/lib/realtime.js";
import { createSlackDriver } from "../src/lib/slack.js";
import { createSmsDriver, createWhatsappDriver } from "../src/lib/sms.js";
import { createStorageDriver } from "../src/lib/storage.js";
import { MemoryStore } from "../src/store/memory.js";

export interface TestApp {
  app: Express;
  ctx: AppContext;
  store: MemoryStore;
  uploadDir: string;
}

export function createTestApp(): TestApp {
  process.env.NODE_ENV = "test";
  process.env.RATE_LIMIT_DISABLED = "1";
  process.env.OUTBOX_AUTODRAIN = "false";
  process.env.WEB_URL = "http://localhost:5173";
  process.env.API_URL = "http://localhost:4000";
  delete process.env.GROQ_API_KEY;
  resetEnvCache();
  const uploadDir = mkdtempSync(join(tmpdir(), "scopelock-uploads-"));
  const env = { ...getEnv(), UPLOAD_DIR: uploadDir };
  const store = new MemoryStore();
  const ctx: AppContext = {
    store,
    env,
    email: createEmailDriver(env),
    storage: createStorageDriver(env),
    realtime: createRealtimeDriver(env),
    slack: createSlackDriver(env),
    sms: createSmsDriver(env),
    whatsapp: createWhatsappDriver(env),
  };
  return { app: createApp(ctx), ctx, store, uploadDir };
}

export type Agent = ReturnType<typeof request.agent>;

export function agentFor(app: Express): Agent {
  return request.agent(app);
}

export interface Registered {
  user: { id: string; email: string; name: string };
  organization: { id: string; name: string };
  agent: Agent;
}

export async function register(
  app: Express,
  overrides?: { name?: string; email?: string; password?: string; organizationName?: string },
): Promise<Registered> {
  const agent = agentFor(app);
  const email = overrides?.email ?? `user-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`;
  const res = await agent.post("/api/v1/auth/register").send({
    name: overrides?.name ?? "Test User",
    email,
    password: overrides?.password ?? "password1234",
    organizationName: overrides?.organizationName ?? "Test Org",
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body.user as Registered["user"], organization: res.body.organization as Registered["organization"], agent };
}

export async function createClient(_app: Express, agent: Agent, organizationId: string, name = "Globex"): Promise<{ id: string }> {
  const res = await agent.post("/api/v1/clients").send({ organizationId, name });
  if (res.status !== 201) throw new Error(`createClient failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}

export async function createProject(
  _app: Express,
  agent: Agent,
  args: { organizationId: string; clientId: string; name?: string },
): Promise<{ id: string }> {
  const res = await agent
    .post("/api/v1/projects")
    .send({ organizationId: args.organizationId, clientId: args.clientId, name: args.name ?? "Website" });
  if (res.status !== 201) throw new Error(`createProject failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string };
}

/** Full agency fixture: owner + client user with project roles. */
export async function agencyFixture(app: Express): Promise<{
  owner: Registered;
  client: Registered;
  clientUserId: string;
  organizationId: string;
  clientId: string;
  projectId: string;
}> {
  const owner = await register(app, { email: "owner@agency.test", organizationName: "Agency" });
  const client = await register(app, { email: "carl@client.test", organizationName: "Temp" });
  // Invite the client user into the agency org with a project role.
  const invite = await owner.agent.post(`/api/v1/organizations/${owner.organization.id}/invitations`).send({
    email: "carl@client.test",
    role: "CLIENT",
  });
  if (invite.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  const accept = await client.agent
    .post(`/api/v1/auth/invitations/${(invite.body as { token: string }).token}/accept`)
    .send({});
  if (accept.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accept.body)}`);
  const created = await createClient(app, owner.agent, owner.organization.id);
  const project = await createProject(app, owner.agent, { organizationId: owner.organization.id, clientId: created.id });
  const addMember = await owner.agent.post(`/api/v1/projects/${project.id}/members`).send({
    userId: client.user.id,
    role: "CLIENT_APPROVER",
  });
  if (addMember.status !== 201) throw new Error(`addMember failed: ${JSON.stringify(addMember.body)}`);
  return {
    owner,
    client,
    clientUserId: client.user.id,
    organizationId: owner.organization.id,
    clientId: created.id,
    projectId: project.id,
  };
}

/** Draft scope with two requirements, ready to publish. */
export async function draftScope(agent: Agent, projectId: string): Promise<{ draftId: string; version: number }> {
  const draft = await agent.post(`/api/v1/projects/${projectId}/scope-versions/draft`).send({ title: "Baseline" });
  if (draft.status !== 201) throw new Error(`draft failed: ${JSON.stringify(draft.body)}`);
  const draftId = (draft.body as { id: string }).id;
  for (const [i, title] of ["Homepage", "Blog"].entries()) {
    const res = await agent.post(`/api/v1/projects/${projectId}/requirements`).send({
      draftVersionId: draftId,
      title,
      description: `${title} description`,
      acceptanceCriteria: [`${title} works`],
      order: i,
    });
    if (res.status !== 201) throw new Error(`requirement failed: ${JSON.stringify(res.body)}`);
  }
  const loaded = await agent.get(`/api/v1/scope-versions/${draftId}`);
  return { draftId, version: (loaded.body as { version: number }).version };
}

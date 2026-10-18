/**
 * Portfolio demo seed: builds a "CodeJBorg" workspace from the real portfolio
 * catalogue (prisma/portfolio-data.json) — 10 clients, 16 projects with
 * published scope baselines — plus showcase change/approval lifecycles:
 * approved + amended + implemented (ERP), pending (Haat), estimating with
 * answered clarification (QuickFood), rejected (Nibash), bundled approval
 * (HealthOps), submitted awaiting triage (InterEd), and a no-charge
 * approved + implemented change (Green Biotech, absorbed work).
 *
 * Drives the real HTTP API in-process (supertest) against DATA_FILE or
 * DATABASE_URL from .env. Outbox side effects created while seeding are
 * marked SENT so no demo emails or realtime events leak to real providers.
 *
 * Usage: npm run seed:portfolio
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../apps/api/src/app.js";
import type { AppContext } from "../apps/api/src/app-context.js";
import { getEnv } from "../apps/api/src/env.js";
import { createEmailDriver } from "../apps/api/src/lib/email.js";
import { createRealtimeDriver } from "../apps/api/src/lib/realtime.js";
import { createStorageDriver } from "../apps/api/src/lib/storage.js";
import { createStore, nowIso } from "../apps/api/src/store/index.js";
import type { Store } from "../apps/api/src/store/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(path: string): void {
  try {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      const k = key?.trim();
      if (!k || process.env[k] !== undefined) continue;
      let v = rest.join("=").trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

interface PortfolioFunctionality {
  name: string;
  description: string[];
}
interface PortfolioProject {
  slug: string;
  title: string;
  overview: string;
  functionalities: PortfolioFunctionality[];
  technologies: Record<string, string>;
  live?: string;
  repo?: string;
  frontend?: string;
  backend?: string;
}

interface SeedClient {
  key: string;
  name: string;
  company: string | null;
  contactName: string;
  contactEmail: string;
  notes: string;
}

const OWNER = { name: "Junaid Islam", email: "demo@codejborg.studio", password: "password1234", org: "CodeJBorg" };

// slug -> client key
const CLIENT_FOR: Record<string, string> = {
  "green-biotech": "greenbiotech",
  "green-biotech-erp": "greenbiotech",
  "arvix-creative": "arvix",
  "arvix-resume-builder": "arvix",
  "al-noor-specialised-hospital": "alnoor",
  "nibash-property-platform": "privateclient",
  "haat-marketplace": "haat",
  "quickfood-delivery-app": "quickfood",
  nex_tech_care: "nextechcare",
  intered_hub: "intered",
  healthops_connect: "healthops",
  forgeline: "labs",
  draftiq: "labs",
  ledgerly: "labs",
  retro_book_store: "labs",
  "asocial-media": "labs",
};

const CLIENTS: SeedClient[] = [
  { key: "greenbiotech", name: "Green Biotech", company: "Green Biotech Ltd", contactName: "Nazmul Hasan", contactEmail: "nazmul@greenbiotech.test", notes: "Agro-biotech manufacturer. Corporate site + full ERP (sales, stock, accounting)." },
  { key: "arvix", name: "Arvix Creative", company: "Arvix Creative", contactName: "Arif Chowdhury", contactEmail: "arif@arvixcreative.test", notes: "Creative studio. Marketing site, academy platform + ATS resume builder." },
  { key: "alnoor", name: "Al Noor Specialised Hospital", company: "Al Noor Specialised Hospital", contactName: "Dr. Tanzeem Chowdhury", contactEmail: "info@alnoorsh.test", notes: "Hospital marketing site: doctors, departments, packages, appointment booking." },
  { key: "privateclient", name: "Private Client", company: null, contactName: "Rahim Uddin", contactEmail: "rahim@privateclient.test", notes: "Property platform (Nibash): rentals, sales, serviced stays. Name withheld per NDA." },
  { key: "haat", name: "Haat Technologies", company: "Haat Technologies Ltd", contactName: "Tanvir Ahmed", contactEmail: "tanvir@haat.test", notes: "Multi-vendor marketplace for Bangladesh: buyer app, seller center, rider app, admin console." },
  { key: "quickfood", name: "QuickFood Ltd", company: "QuickFood Ltd", contactName: "Sakib Hasan", contactEmail: "sakib@quickfood.test", notes: "Food delivery platform: customer app, restaurant partner tools, rider app, realtime tracking." },
  { key: "nextechcare", name: "NexTechCare", company: "NexTechCare", contactName: "Farhana Akter", contactEmail: "farhana@nextechcare.test", notes: "Technology support marketplace with AI triage, SLA tracking, engineer trust scores." },
  { key: "intered", name: "InterEd", company: "InterEd Ltd", contactName: "Mehedi Hassan", contactEmail: "mehedi@intered.test", notes: "Video-first course platform: learning player, teacher studio, certificates." },
  { key: "healthops", name: "HealthOps", company: "HealthOps Ltd", contactName: "Dr. Sadia Rahman", contactEmail: "sadia@healthops.test", notes: "Hospital operations platform: care finder, booking, queue, e-prescriptions, bed board." },
  { key: "labs", name: "CodeJBorg Labs", company: "CodeJBorg", contactName: "Junaid Islam", contactEmail: "demo@codejborg.studio", notes: "Internal products: Forgeline, Draftiq, Ledgerly, RetroBookStore, aSocial." },
];

// slug -> budget in BDT
const BUDGETS: Record<string, number> = {
  "green-biotech": 650000,
  "green-biotech-erp": 1800000,
  "arvix-creative": 750000,
  "arvix-resume-builder": 950000,
  "al-noor-specialised-hospital": 550000,
  "nibash-property-platform": 1400000,
  "haat-marketplace": 1650000,
  "quickfood-delivery-app": 1500000,
  nex_tech_care: 1250000,
  intered_hub: 1350000,
  healthops_connect: 1700000,
  forgeline: 400000,
  draftiq: 1100000,
  ledgerly: 900000,
  retro_book_store: 700000,
  "asocial-media": 1200000,
};

type Agent = ReturnType<typeof request.agent>;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

function techSummary(tech: Record<string, string>): string {
  return Object.entries(tech)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
}

async function sweepOutbox(store: Store): Promise<number> {
  // The seed database receives no other traffic; anything pending is ours.
  // Mark it delivered so demo setup never emails/Ably-publishes via the
  // user's real providers (their dev server auto-drains every 15s).
  const batch = await store.claimOutboxBatch(200, nowIso());
  for (const event of batch) {
    await store.updateOutbox(event.id, { status: "SENT", attempts: event.attempts + 1, lastError: null });
  }
  return batch.length;
}

async function main(): Promise<void> {
  loadDotEnv(join(HERE, "..", ".env"));
  // Prefer a direct (non-pooler) connection for seeding: long interactive
  // transactions (e.g. publishing multi-requirement baselines) are dropped by
  // Neon's transaction-mode pooler. Same database, stable transactions.
  if ((process.env.DATABASE_URL ?? "").includes("-pooler.")) {
    process.env.DATABASE_URL = (process.env.DATABASE_URL as string).replace("-pooler.", ".");
    console.log("Seed uses the direct Neon connection (same database).");
  }
  // Harden the seed process: no rate limits, no background drains, no provider keys.
  process.env.RATE_LIMIT_DISABLED = "1";
  process.env.OUTBOX_AUTODRAIN = "false";
  delete process.env.EMAIL_API_KEY;
  delete process.env.ABLY_API_KEY;
  delete process.env.GROQ_API_KEY;

  const env = getEnv();
  const store = await createStore(env);
  const ctx: AppContext = {
    store,
    env,
    email: createEmailDriver(env),
    storage: createStorageDriver(env),
    realtime: createRealtimeDriver(env),
  };
  const app: Express = createApp(ctx);

  const data = JSON.parse(readFileSync(join(HERE, "portfolio-data.json"), "utf8")) as PortfolioProject[];
  console.log(`Seeding ${data.length} portfolio projects…`);

  async function expectOk(res: request.Response, what: string, want = [200, 201]): Promise<Record<string, unknown>> {
    if (!want.includes(res.status)) {
      throw new Error(`${what} failed: ${res.status} ${JSON.stringify(res.body).slice(0, 800)}`);
    }
    return res.body as Record<string, unknown>;
  }

  // Resumable: register, or log in when a previous run already created the account.
  async function registerOrLogin(name: string, email: string, org: string): Promise<{ id: string; agent: Agent }> {
    const agent = request.agent(app);
    const attempt = await agent
      .post("/api/v1/auth/register")
      .send({ name, email, password: OWNER.password, organizationName: org });
    if (attempt.status === 201) {
      return { id: ((attempt.body as Record<string, unknown>).user as { id: string }).id, agent };
    }
    if (attempt.status !== 409) {
      throw new Error(`register ${email} failed: ${attempt.status} ${JSON.stringify(attempt.body).slice(0, 500)}`);
    }
    const login = await expectOk(
      await agent.post("/api/v1/auth/login").send({ email, password: OWNER.password }),
      `login ${email}`,
    );
    return { id: ((login.user as { id: string } | undefined)?.id ?? (await store.findUserByEmail(email))?.id) as string, agent };
  }

  const owner = await registerOrLogin(OWNER.name, OWNER.email, OWNER.org);
  const ownerReg = await store.findUserByEmail(OWNER.email);
  if (!ownerReg) throw new Error("owner registration did not persist");
  const ownerOrgs = await store.listOrganizationsForUser(ownerReg.id);
  const orgId = ownerOrgs.find((o) => o.name === OWNER.org)?.id ?? ownerOrgs[0]?.id;
  if (!orgId) throw new Error("owner org not found");
  console.log(`org=${orgId}`);

  // PRO plan: 16 demo projects exceed the FREE limit of 3.
  await expectOk(await owner.agent.patch(`/api/v1/organizations/${orgId}`).send({ plan: "PRO" }), "upgrade plan");

  // Client users who log in to review/decide (invited as CLIENT + project approver).
  const clientLogins: Record<string, { name: string; email: string; agent: Agent; userId: string }> = {};
  for (const key of ["greenbiotech", "haat", "quickfood", "privateclient", "healthops"]) {
    const c = CLIENTS.find((x) => x.key === key) as SeedClient;
    const reg = await registerOrLogin(c.contactName, c.contactEmail, `${c.name} Temp`);
    clientLogins[key] = { name: c.contactName, email: c.contactEmail, agent: reg.agent, userId: reg.id };
  }

  // ----- Clients (find-or-create) -----
  const clientIds: Record<string, string> = {};
  const existingClients = await store.listClients(orgId);
  for (const c of CLIENTS) {
    const found = existingClients.find((x) => x.name === c.name);
    if (found) {
      clientIds[c.key] = found.id;
      continue;
    }
    const body = await expectOk(
      await owner.agent
        .post("/api/v1/clients")
        .send({ organizationId: orgId, name: c.name, company: c.company ?? undefined, contacts: [{ name: c.contactName, email: c.contactEmail }], notes: c.notes }),
      `create client ${c.key}`,
      [201],
    );
    clientIds[c.key] = body.id as string;
  }

  // ----- Projects (find-or-create) -----
  const projectIds: Record<string, string> = {};
  const existingProjects = await store.listProjects(orgId);
  for (const p of data) {
    const clientKey = CLIENT_FOR[p.slug];
    const name = truncate(p.title, 160);
    const found = existingProjects.find((x) => x.name === name);
    if (found) {
      projectIds[p.slug] = found.id;
    } else {
      const budgetBdt = BUDGETS[p.slug] ?? 800000;
      const body = await expectOk(
        await owner.agent.post("/api/v1/projects").send({
          organizationId: orgId,
          clientId: clientIds[clientKey],
          name,
          currency: "BDT",
          budgetMinor: budgetBdt * 100,
          startDate: "2026-01-15T00:00:00.000Z",
          targetDate: "2026-06-30T00:00:00.000Z",
        }),
        `create project ${p.slug}`,
        [201],
      );
      projectIds[p.slug] = body.id as string;
    }
    const projectId = projectIds[p.slug] as string;
    await expectOk(
      await owner.agent.post(`/api/v1/projects/${projectId}/members`).send({ userId: ownerReg.id, role: "LEAD" }),
      `owner lead ${p.slug}`,
      [200, 201],
    );
  }

  // Invite client users into the org (accept via their own sessions).
  for (const key of Object.keys(clientLogins)) {
    const login = clientLogins[key] as { agent: Agent; email: string; userId: string };
    if (await store.findMembership(orgId, login.userId)) continue;
    const firstProject = data.find((p) => CLIENT_FOR[p.slug] === key) as PortfolioProject;
    const invite = await expectOk(
      await owner.agent.post(`/api/v1/organizations/${orgId}/invitations`).send({
        email: login.email,
        role: "CLIENT",
        projectId: projectIds[firstProject.slug],
        projectRole: "CLIENT_APPROVER",
      }),
      `invite ${login.email}`,
      [201],
    );
    await expectOk(
      await login.agent.post(`/api/v1/auth/invitations/${invite.token as string}/accept`).send({}),
      `accept ${login.email}`,
      [200],
    );
    await sweepOutbox(store);
  }

  // Nazmul approves both Green Biotech projects (invite covered the first).
  await expectOk(
    await owner.agent
      .post(`/api/v1/projects/${projectIds["green-biotech-erp"]}/members`)
      .send({ userId: (clientLogins.greenbiotech as { userId: string }).userId, role: "CLIENT_APPROVER" }),
    "approver green-biotech-erp",
    [200, 201],
  );

  // ----- Scope baselines for every project (skip when already published) -----
  const firstRequirementIds: Record<string, string> = {};
  for (const p of data) {
    const projectId = projectIds[p.slug] as string;
    const versions = await store.listProjectScopeVersions(projectId);
    if (versions.some((v) => v.status === "PUBLISHED")) {
      const reqs = await store.listRequirements(projectId);
      if (reqs[0]) firstRequirementIds[p.slug] = reqs[0].id;
      console.log(`baseline: ${p.slug} (already published, skipping)`);
      continue;
    }
    // Reuse an orphaned draft from an interrupted run instead of creating a duplicate.
    let draftId = versions.find((v) => v.status === "DRAFT")?.id ?? null;
    if (!draftId) {
      const draft = await expectOk(
        await owner.agent.post(`/api/v1/projects/${projectId}/scope-versions/draft`).send({ title: "Baseline v1" }),
        `draft ${p.slug}`,
        [201],
      );
      draftId = draft.id as string;
    }
    const links: string[] = [];
    if (p.live) links.push(`Live demo: ${p.live}`);
    if (p.repo) links.push(`Repo: ${p.repo}`);
    if (p.frontend) links.push(`Frontend: ${p.frontend}`);
    if (p.backend) links.push(`Backend: ${p.backend}`);
    const funcs = p.functionalities.slice(0, 7);
    const existingRevs = await store.listRevisionsByVersion(draftId);
    if (existingRevs.length > 0) {
      if (existingRevs[0]) firstRequirementIds[p.slug] = existingRevs[0].requirementId;
    } else {
      for (const [i, f] of funcs.entries()) {
        const desc = f.description.join(" ");
        const req = await expectOk(
          await owner.agent.post(`/api/v1/projects/${projectId}/requirements`).send({
            draftVersionId: draftId,
            title: truncate(f.name, 200),
            description: truncate(desc, 2000),
            acceptanceCriteria: f.description.slice(0, 3).map((d) => truncate(d, 300)),
            category: "Feature",
            priority: i < 2 ? "HIGH" : "MEDIUM",
            order: i,
          }),
          `requirement ${p.slug} / ${f.name.slice(0, 30)}`,
          [201],
        );
        if (i === 0) firstRequirementIds[p.slug] = (req.requirement as { id: string } | undefined)?.id ?? (req.id as string);
      }
    }
    const loaded = (await expectOk(await owner.agent.get(`/api/v1/scope-versions/${draftId}`), `load draft ${p.slug}`)) as {
      version: number;
    };
    await expectOk(
      await owner.agent.patch(`/api/v1/scope-versions/${draftId}`).send({
        expectedVersion: loaded.version,
        summary: truncate(`${p.overview} ${links.join(" ")} Tech: ${techSummary(p.technologies)}`, 2000),
        assumptions: ["Client provides content, brand assets, and staging credentials within week 1", "Third-party API quotas covered by the client"],
        exclusions: ["Native mobile apps (web responsive only unless stated)", "Data migration from legacy systems", "Ongoing maintenance after handover"],
      }),
      `annotate draft ${p.slug}`,
    );
    // Publish with retries: pooled Postgres can drop an interactive transaction.
    let published = false;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3 && !published; attempt++) {
      const reloaded = (await expectOk(await owner.agent.get(`/api/v1/scope-versions/${draftId}`), `reload draft ${p.slug}`)) as {
        version: number;
        status: string;
      };
      if (reloaded.status === "PUBLISHED") {
        published = true;
        break;
      }
      const res = await owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: reloaded.version });
      if (res.status === 200 || res.status === 201) {
        published = true;
      } else {
        lastErr = new Error(`publish ${p.slug} attempt ${attempt + 1}: ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    if (!published) throw lastErr;
    console.log(`baseline: ${p.slug} (${funcs.length} requirements)`);
  }

  // ----- Helpers for showcase flows -----
  async function createChange(
    slug: string,
    input: { title: string; description: string; source?: string },
  ): Promise<{ id: string; version: number; number: string }> {
    const body = await expectOk(
      await owner.agent.post(`/api/v1/projects/${projectIds[slug]}/change-requests`).send({
        title: input.title,
        description: input.description,
        source: input.source ?? "CLIENT",
      }),
      `create change ${slug}`,
      [201],
    );
    return { id: body.id as string, version: body.version as number, number: body.number as string };
  }

  async function transition(changeId: string, slug: string, to: string, version: number): Promise<number> {
    const body = await expectOk(
      await owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: version, status: to }),
      `transition ${slug} -> ${to}`,
    );
    return body.version as number;
  }

  async function recordImpact(
    changeId: string,
    slug: string,
    impact: Record<string, unknown>,
  ): Promise<void> {
    await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ currency: "BDT", ...impact }),
      `impact ${slug}`,
      [200, 201],
    );
  }

  async function linkRequirement(changeId: string, slug: string): Promise<void> {
    const reqId = firstRequirementIds[slug];
    if (!reqId) return;
    await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${changeId}/links`).send({ targetType: "REQUIREMENT", targetRequirementId: reqId }),
      `link ${slug}`,
      [200, 201],
    );
  }

  async function sendApproval(
    changeId: string,
    slug: string,
    approverKey: string,
    title: string,
  ): Promise<{ approvalId: string; reviewUrl: string; token: string }> {
    const login = clientLogins[approverKey] as { userId: string };
    const body = await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
        approverUserIds: [login.userId],
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        title,
      }),
      `send ${slug}`,
      [201],
    );
    await sweepOutbox(store);
    const reviewUrl = (body.reviewUrls as string[])[0] as string;
    const token = reviewUrl.split("/review/")[1] as string;
    return { approvalId: (body.approval as { id: string }).id, reviewUrl, token };
  }

  async function hasChanges(slug: string): Promise<boolean> {
    return (await store.listChanges(projectIds[slug] as string)).length > 0;
  }

  // 1) Green Biotech ERP — full lifecycle: approved via review link, amended into
  // scope v2, implemented, with delivery evidence.
  if (!(await hasChanges("green-biotech-erp"))) {
    const slug = "green-biotech-erp";
    const ch = await createChange(slug, {
      title: "Salesman mobile dashboard",
      description:
        "Field salesmen need a phone-first dashboard: today's route orders, collection targets vs achieved, and pending deliveries. " +
        "Requested by Nazmul after the first month of ERP usage; highest-voted item in the sales team retro.",
      source: "CLIENT",
    });
    let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
    v = await transition(ch.id, slug, "TRIAGING", v);
    v = await transition(ch.id, slug, "ESTIMATING", v);
    await recordImpact(ch.id, slug, {
      effortDays: 8,
      priceMinor: 9500000,
      timelineDays: 10,
      milestoneEffect: "Phase-2 reporting milestone shifts by 2 weeks",
      risks: ["Salesmen use low-end Android devices — bundle size must stay small"],
      notes: "Includes PWA packaging so it installs on phones without a Play Store release",
      confidence: "HIGH",
    });
    await linkRequirement(ch.id, slug);
    const sent = await sendApproval(ch.id, slug, "greenbiotech", "Salesman mobile dashboard — ৳95,000");
    // Client decides from the review link (anonymous token path, like a real client).
    await expectOk(
      await request(app).post(`/api/v1/approval-requests/${sent.token}/decisions`).send({
        decision: "APPROVED",
        comment: "Approved. Please prioritize the collection view — that is what the team checks every morning.",
        confirm: true,
      }),
      "decide erp",
      [201],
    );
    await sweepOutbox(store);
    // Convert into a scope amendment and publish v2.
    const amendment = await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${ch.id}/convert-to-scope`).send({ title: "Amendment v2 — salesman dashboard" }),
      "convert erp",
      [200, 201],
    );
    const amendmentId = ((amendment.draft as { id?: string } | undefined)?.id ?? amendment.id) as string;
    await expectOk(
      await owner.agent.post(`/api/v1/projects/${projectIds[slug]}/requirements`).send({
        draftVersionId: amendmentId,
        title: "Salesman mobile dashboard (PWA)",
        description: "Phone-first dashboard for field salesmen: route orders, collection targets vs achieved, pending deliveries. Installable PWA, works on low-end Android.",
        acceptanceCriteria: ["Loads in <3s on a 3G connection", "Collection view matches ERP figures exactly", "Installable as a PWA on Android Chrome"],
        category: "Feature",
        priority: "HIGH",
        order: 10,
      }),
      "amendment requirement erp",
      [201],
    );
    const av = (await expectOk(await owner.agent.get(`/api/v1/scope-versions/${amendmentId}`), "load amendment")) as { version: number };
    await expectOk(
      await owner.agent.post(`/api/v1/scope-versions/${amendmentId}/publish`).send({ expectedVersion: av.version }),
      "publish v2 erp",
    );
    const detail = (await expectOk(await owner.agent.get(`/api/v1/change-requests/${ch.id}`), "read erp change")) as { version: number };
    await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${ch.id}/implement`).send({ expectedVersion: detail.version }),
      "implement erp",
    );
    await expectOk(
      await owner.agent.post(`/api/v1/requirements/${firstRequirementIds[slug]}/evidence`).send({
        type: "URL",
        title: "ERP sales dashboard walkthrough",
        url: "https://junaidul.pro.bd/project/green-biotech-erp",
      }),
      "evidence erp",
      [201],
    );
    await expectOk(
      await owner.agent.post(`/api/v1/projects/${projectIds[slug]}/decision-notes`).send({
        targetType: "CHANGE",
        targetId: ch.id,
        body: "Decision: ship the collection-first PWA before the Phase-2 reporting milestone. Rationale: daily active use by 40+ salesmen outweighs the 2-week reporting slip. Revisit reporting dates once the dashboard is in the field.",
      }),
      "decision note erp",
      [201],
    );
    // A couple of baseline requirements move through delivery.
    const reqs = (await expectOk(await owner.agent.get(`/api/v1/projects/${projectIds[slug]}/requirements`), "list erp reqs")) as {
      data: Array<{ id: string }>;
    };
    for (const [i, r] of (reqs.data ?? []).slice(0, 2).entries()) {
      await expectOk(
        await owner.agent.patch(`/api/v1/requirements/${r.id}`).send({ status: "IN_PROGRESS" }),
        `erp req progress ${i}`,
      );
    }
    console.log("showcase: green-biotech-erp approved -> amended (v2) -> implemented");
  }

  // 2) Haat — change sent, awaiting the client's decision (inbox + review link).
  let haatReviewUrl = "";
  if (!(await hasChanges("haat-marketplace"))) {
    const slug = "haat-marketplace";
    const ch = await createChange(slug, {
      title: "Team Buy group-buying module",
      description:
        "Group buying: a buyer starts a team at the group price, shares the link, and everyone pays less when the team fills. " +
        "Includes the expiry/refund background job and seller-side Team Buy setup.",
      source: "AGENCY",
    });
    let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
    v = await transition(ch.id, slug, "TRIAGING", v);
    v = await transition(ch.id, slug, "ESTIMATING", v);
    await recordImpact(ch.id, slug, {
      effortDays: 12,
      priceMinor: 14500000,
      timelineDays: 15,
      milestoneEffect: "Adds 3 weeks to the launch milestone",
      risks: ["Refund edge cases need careful testing", "Depends on the Honest Discount price-history work"],
      notes: "Priced with the EU Omnibus-rule price history included",
      confidence: "MEDIUM",
    });
    await linkRequirement(ch.id, slug);
    const sent = await sendApproval(ch.id, slug, "haat", "Team Buy group buying — ৳145,000");
    haatReviewUrl = sent.reviewUrl;
    console.log("showcase: haat-marketplace pending approval");
  }

  // 3) QuickFood — estimating with an answered clarification round.
  if (!(await hasChanges("quickfood-delivery-app"))) {
    const slug = "quickfood-delivery-app";
    const ch = await createChange(slug, {
      title: "Scheduled delivery slots",
      description:
        "Let customers pick a delivery window (e.g. 12:30–1:00) at checkout instead of ASAP-only. Kitchens see slot demand on the board.",
      source: "CLIENT",
    });
    let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
    v = await transition(ch.id, slug, "TRIAGING", v);
    v = await transition(ch.id, slug, "NEEDS_CLARIFICATION", v);
    const clar = await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${ch.id}/clarifications`).send({
        question: "Should slots be per-restaurant (each kitchen sets its own windows) or platform-wide (e.g. lunch/dinner rush windows for all)?",
      }),
      "ask clarification",
      [201],
    );
    const sakib = clientLogins.quickfood as { agent: Agent };
    await expectOk(
      await sakib.agent.post(`/api/v1/change-requests/${ch.id}/clarifications/${clar.id as string}/answer`).send({
        answer: "Per-restaurant. Kitchens know their own rush hours — give them 30-minute window templates they can toggle.",
      }),
      "answer clarification",
    );
    v = await transition(ch.id, slug, "ESTIMATING", v);
    await recordImpact(ch.id, slug, {
      effortDays: 6,
      priceMinor: 6800000,
      timelineDays: 8,
      milestoneEffect: "No milestone shift — fits inside the current sprint buffer",
      risks: ["Rider ETA math must account for batched slot orders"],
      confidence: "HIGH",
    });
    await linkRequirement(ch.id, slug);
    await sweepOutbox(store);
    console.log("showcase: quickfood-delivery-app estimating (clarification answered)");
  }

  // 4) Nibash — sent and rejected with a reason.
  if (!(await hasChanges("nibash-property-platform"))) {
    const slug = "nibash-property-platform";
    const ch = await createChange(slug, {
      title: "Full Bangla translation",
      description:
        "Translate the entire renter/owner experience into Bangla, including transactional emails and the admin booking views.",
      source: "AGENCY",
    });
    let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
    v = await transition(ch.id, slug, "TRIAGING", v);
    v = await transition(ch.id, slug, "ESTIMATING", v);
    await recordImpact(ch.id, slug, {
      effortDays: 5,
      priceMinor: 4200000,
      timelineDays: 7,
      milestoneEffect: "No milestone shift",
      risks: ["Legal listing text needs a professional translator, not machine output"],
      confidence: "MEDIUM",
    });
    await linkRequirement(ch.id, slug);
    const sent = await sendApproval(ch.id, slug, "privateclient", "Full Bangla translation — ৳42,000");
    await expectOk(
      await request(app).post(`/api/v1/approval-requests/${sent.token}/decisions`).send({
        decision: "REJECTED",
        comment: "Rejecting for now — budget freeze this quarter. Revisit after the payment milestone lands.",
        confirm: true,
      }),
      "reject nibash",
      [201],
    );
    await sweepOutbox(store);
    console.log("showcase: nibash-property-platform rejected");
  }

  // 5) HealthOps — two small changes bundled into one approval, decided in-app.
  if (!(await hasChanges("healthops_connect"))) {
    const slug = "healthops_connect";
    const changes: string[] = [];
    for (const [title, desc, days, price] of [
      ["SMS fallback for queue tokens", "When the patient's browser is offline, deliver queue tokens and wait updates over SMS.", 3, 2800000],
      ["Waiting-room TV display", "Privacy-safe waiting-room screen: token numbers only, never patient names.", 2, 1900000],
    ] as Array<[string, string, number, number]>) {
      const ch = await createChange(slug, { title, description: desc, source: "CLIENT" });
      let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
      v = await transition(ch.id, slug, "TRIAGING", v);
      v = await transition(ch.id, slug, "ESTIMATING", v);
      await recordImpact(ch.id, slug, { effortDays: days, priceMinor: price, timelineDays: days + 1, confidence: "HIGH" });
      await linkRequirement(ch.id, slug);
      changes.push(ch.id);
    }
    const bundle = await expectOk(
      await owner.agent.post(`/api/v1/projects/${projectIds[slug]}/bundles`).send({ name: "Launch hardening", changeRequestIds: changes }),
      "create bundle",
      [201],
    );
    const sadia = clientLogins.healthops as { agent: Agent; userId: string };
    const sent = await expectOk(
      await owner.agent.post(`/api/v1/bundles/${bundle.id as string}/approval-requests`).send({
        approverUserIds: [sadia.userId],
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        title: "Launch hardening bundle — ৳47,000",
      }),
      "send bundle",
      [201],
    );
    await sweepOutbox(store);
    // Client approves from inside the app (authenticated path).
    await expectOk(
      await sadia.agent.post(`/api/v1/approval-requests/${(sent.approval as { id: string }).id}/decisions`).send({
        decision: "APPROVED",
        comment: "Both are launch blockers for the pilot ward. Approved.",
        confirm: true,
      }),
      "decide bundle",
      [201],
    );
    await sweepOutbox(store);
    console.log("showcase: healthops_connect bundle approved");
  }

  // 6) InterEd — fresh request awaiting triage.
  if (!(await hasChanges("intered_hub"))) {
    const slug = "intered_hub";
    const ch = await createChange(slug, {
      title: "Public certificate verification page",
      description:
        "Employers should be able to verify a certificate code on a public page (no login): learner initials, course, issue date.",
      source: "CLIENT",
    });
    await transition(ch.id, slug, "SUBMITTED", ch.version);
    console.log("showcase: intered_hub submitted (awaiting triage)");
  }

  // 7) Green Biotech (corporate site) — no-charge change, approved and
  // implemented: the contract ledger's absorbed-work demo.
  if (!(await hasChanges("green-biotech"))) {
    const slug = "green-biotech";
    const ch = await createChange(slug, {
      title: "Footer compliance links",
      description:
        "Add privacy policy, terms of use, and company registration links to the site footer. Small goodwill fix, done at no charge.",
      source: "AGENCY",
    });
    let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
    v = await transition(ch.id, slug, "TRIAGING", v);
    v = await transition(ch.id, slug, "ESTIMATING", v);
    await recordImpact(ch.id, slug, {
      effortDays: 1,
      priceMinor: 0,
      timelineDays: 1,
      notes: "Goodwill gesture: explicitly no charge",
      confidence: "HIGH",
    });
    await linkRequirement(ch.id, slug);
    const sent = await sendApproval(ch.id, slug, "greenbiotech", "Footer compliance links — no charge");
    await expectOk(
      await request(app).post(`/api/v1/approval-requests/${sent.token}/decisions`).send({
        decision: "APPROVED",
        comment: "Thank you — much appreciated.",
        confirm: true,
      }),
      "decide green-biotech",
      [201],
    );
    await sweepOutbox(store);
    const detail = (await expectOk(await owner.agent.get(`/api/v1/change-requests/${ch.id}`), "read green-biotech change")) as { version: number };
    await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${ch.id}/implement`).send({ expectedVersion: detail.version }),
      "implement green-biotech",
    );
    console.log("showcase: green-biotech no-charge change approved -> implemented (absorbed)");
  }

  // Allowance pool showcase on Haat: granted by the client, drawn by an
  // approved change, objected, then upheld (resumable on existing pools).
  if ((await store.listAllowancePools(projectIds["haat-marketplace"] as string)).length === 0) {
    const slug = "haat-marketplace";
    const projectId = projectIds[slug] as string;
    const haat = clientLogins.haat as { agent: Agent; userId: string };
    const poolBody = (await expectOk(
      await owner.agent.post(`/api/v1/projects/${projectId}/allowance-pools`).send({
        name: "Sprint buffer",
        kind: "AMOUNT",
        totalMinor: 20000000,
        currency: "BDT",
        objectionWindowHours: 72,
        enabled: true,
      }),
      "seed allowance pool",
      [201],
    )) as { id: string };
    const grantBody = (await expectOk(
      await owner.agent.post(`/api/v1/allowance-pools/${poolBody.id}/approval-requests`).send({
        approverUserIds: [haat.userId],
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      }),
      "seed pool grant",
      [201],
    )) as { reviewUrls: string[] };
    const grantToken = (grantBody.reviewUrls[0] as string).split("/review/")[1] as string;
    await expectOk(
      await request(app).post(`/api/v1/approval-requests/${grantToken}/decisions`).send({
        decision: "APPROVED",
        comment: "Buffer approved for the quarter.",
        confirm: true,
      }),
      "seed grant decision",
      [201],
    );
    const ch = await createChange(slug, {
      title: "Rider payout report",
      description: "Weekly rider payout summary for the seller center: completed deliveries, tips, and adjustments.",
    });
    let v = await transition(ch.id, slug, "SUBMITTED", ch.version);
    v = await transition(ch.id, slug, "TRIAGING", v);
    v = await transition(ch.id, slug, "ESTIMATING", v);
    await recordImpact(ch.id, slug, { effortDays: 3, priceMinor: 4500000, timelineDays: 5, confidence: "MEDIUM" });
    await linkRequirement(ch.id, slug);
    const drawBody = (await expectOk(
      await owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
        approverUserIds: [haat.userId],
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        allowancePoolId: poolBody.id,
      }),
      "seed pool-linked send",
      [201],
    )) as { reviewUrls: string[] };
    const drawToken = (drawBody.reviewUrls[0] as string).split("/review/")[1] as string;
    await expectOk(
      await request(app).post(`/api/v1/approval-requests/${drawToken}/decisions`).send({
        decision: "APPROVED",
        comment: "Approved, draw from the buffer.",
        confirm: true,
      }),
      "seed draw decision",
      [201],
    );
    const drawDown = await store.findDrawDownByChange(ch.id);
    if (!drawDown) throw new Error("seed draw-down missing");
    await expectOk(
      await haat.agent.post(`/api/v1/allowance-draw-downs/${drawDown.id}/object`).send({ reason: "The payout report looks high — please double-check the hours." }),
      "seed objection",
    );
    await expectOk(
      await owner.agent.post(`/api/v1/allowance-draw-downs/${drawDown.id}/resolve`).send({
        resolution: "UPHOLD",
        note: "Re-checked against the estimate: 3 days at the agreed rate. The draw stands.",
      }),
      "seed resolution",
    );
    await sweepOutbox(store);
    console.log("showcase: haat allowance pool granted -> drawn -> objected -> upheld");
  }

  // Default rate card + estimate templates for the portfolio org (resumable).
  {
    const existing = (await expectOk(await owner.agent.get(`/api/v1/organizations/${orgId}/rate-cards?limit=1`), "list rate cards")) as {
      data: unknown[];
    };
    if (existing.data.length === 0) {
      await expectOk(
        await owner.agent.post(`/api/v1/organizations/${orgId}/rate-cards`).send({
          name: "CodeJBorg Standard 2026",
          currency: "BDT",
          isDefault: true,
          rates: [
            { role: "Project Manager", hourlyRateMinor: 500000 },
            { role: "Senior Engineer", hourlyRateMinor: 800000 },
            { role: "Engineer", hourlyRateMinor: 550000 },
            { role: "Designer", hourlyRateMinor: 450000 },
            { role: "QA Engineer", hourlyRateMinor: 350000 },
          ],
        }),
        "seed rate card",
        [201],
      );
      await expectOk(
        await owner.agent.post(`/api/v1/organizations/${orgId}/estimate-templates`).send({
          name: "Standard feature",
          items: [
            { label: "Design", role: "Designer", hours: 8 },
            { label: "Build", role: "Senior Engineer", hours: 24 },
            { label: "QA", role: "QA Engineer", hours: 8 },
          ],
          contingencyPct: 10,
          taxPct: null,
        }),
        "seed feature template",
        [201],
      );
      await expectOk(
        await owner.agent.post(`/api/v1/organizations/${orgId}/estimate-templates`).send({
          name: "Small fix",
          items: [
            { label: "Fix", role: "Engineer", hours: 4 },
            { label: "QA", role: "QA Engineer", hours: 2 },
          ],
          contingencyPct: 0,
          taxPct: null,
        }),
        "seed fix template",
        [201],
      );
      console.log("seed: default BDT rate card + 2 estimate templates");
    }
  }

  // Public intake link for the labs project (resumable): submit without an
  // account, then watch it land as an unverified SUBMITTED change.
  let intakeUrl = "";
  {
    const labsId = projectIds.forgeline as string;
    const links = await store.listIntakeLinks(labsId);
    if (links.length === 0) {
      const body = (await expectOk(
        await owner.agent.post(`/api/v1/projects/${labsId}/intake-links`).send({ name: "Website request form" }),
        "seed intake link",
        [201],
      )) as { url: string };
      intakeUrl = body.url.startsWith("http") ? body.url : `${env.WEB_URL}${body.url}`;
      console.log("seed: public intake link for Forgeline");
    }
  }

  await sweepOutbox(store);

  console.log("\nPortfolio seed complete.");
  console.log("  Agency : demo@codejborg.studio / password1234");
  console.log("  Clients: nazmul@greenbiotech.test, tanvir@haat.test, sakib@quickfood.test,");
  console.log("           rahim@privateclient.test, sadia@healthops.test (all / password1234)");
  if (haatReviewUrl) {
    const absolute = haatReviewUrl.startsWith("http") ? haatReviewUrl : `${env.WEB_URL}${haatReviewUrl}`;
    console.log(`  Pending review link (Haat, decide as the client): ${absolute}`);
  } else {
    console.log("  Pending review link (Haat): log in as tanvir@haat.test and open the inbox.");
  }
  if (intakeUrl) {
    console.log(`  Public intake form (Forgeline, no login needed): ${intakeUrl}`);
  }
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});


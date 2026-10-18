/**
 * Local demo seed: creates an organization, users, client, project, published
 * baseline scope, and one change request ready for triage.
 *
 * Usage: npm run seed -w apps/api   (uses DATA_FILE or DATABASE_URL from .env)
 */
import { hashPassword } from "../apps/api/src/lib/password.js";
import { getEnv } from "../apps/api/src/env.js";
import { createStore } from "../apps/api/src/store/index.js";
import { FileStore } from "../apps/api/src/store/file-store.js";

async function main(): Promise<void> {
  const env = getEnv();
  const store = await createStore(env);

  const existing = await store.findUserByEmail("olivia@acme.test");
  if (existing) {
    console.log("Seed data already present — skipping.");
    return;
  }

  await store.transaction(async (tx) => {
    const owner = await tx.createUser({
      email: "olivia@acme.test",
      name: "Olivia Owner",
      passwordHash: await hashPassword("password1234"),
    });
    const clientUser = await tx.createUser({
      email: "carl@client.test",
      name: "Carl Client",
      passwordHash: await hashPassword("password1234"),
    });
    const org = await tx.createOrganization({ name: "Acme Studio" });
    await tx.upsertMembership(org.id, owner.id, "OWNER");
    await tx.upsertMembership(org.id, clientUser.id, "CLIENT");
    const client = await tx.createClient({
      organizationId: org.id,
      name: "Globex",
      company: "Globex Inc",
      contacts: [{ name: "Carl Client", email: "carl@client.test" }],
      notes: "Demo client",
    });
    const project = await tx.createProject({
      organizationId: org.id,
      clientId: client.id,
      name: "Website relaunch",
      currency: "USD",
      budgetMinor: 2500000,
      startDate: null,
      targetDate: null,
      settings: { aiEnabled: true, reminderHoursBeforeExpiry: [48, 24] },
    });
    await tx.upsertProjectMember(project.id, owner.id, "LEAD");
    await tx.upsertProjectMember(project.id, clientUser.id, "CLIENT_APPROVER");

    const doc = await tx.createScopeDocument(project.id, "Project scope");
    const baseline = await tx.createScopeVersion({
      scopeDocumentId: doc.id,
      projectId: project.id,
      status: "PUBLISHED",
      title: "Baseline v1",
      summary: "Initial agreed scope",
      assumptions: ["Content provided by the client by week 2"],
      exclusions: ["Mobile apps", "Copywriting"],
      version: 0,
      publishedAt: new Date().toISOString(),
      publishedBy: owner.id,
      createdBy: owner.id,
      supersedesId: null,
    });
    const seeds: Array<{ key: string; title: string; description: string; criteria: string[] }> = [
      {
        key: "REQ-001",
        title: "Marketing homepage",
        description: "Responsive homepage with hero, features, and contact sections.",
        criteria: ["Lighthouse performance score >= 90", "Contact form delivers email"],
      },
      {
        key: "REQ-002",
        title: "Blog with CMS",
        description: "Markdown-based blog with categories and RSS feed.",
        criteria: ["Editors can publish without deploys", "RSS validates"],
      },
      {
        key: "REQ-003",
        title: "Analytics dashboard",
        description: "Privacy-friendly traffic dashboard for editors.",
        criteria: ["Shows daily visitors for 90 days", "No third-party trackers"],
      },
    ];
    for (const [i, s] of seeds.entries()) {
      const req = await tx.createRequirement(project.id, s.key);
      await tx.upsertRevision({
        requirementId: req.id,
        scopeVersionId: baseline.id,
        title: s.title,
        description: s.description,
        acceptanceCriteria: s.criteria,
        category: "Feature",
        priority: "MEDIUM",
        order: i,
      });
      await tx.updateRequirement(req.id, { status: "AGREED" });
    }
    // Reset counters to match seeded keys.
    await tx.updateProject(project.id, { changeCounter: 0, requirementCounter: 3 } as never);

    const change = await tx.createChange({
      projectId: project.id,
      title: "Add customer testimonials section",
      description: "Client asked for a testimonials carousel on the homepage after kickoff.",
      source: "CLIENT",
      status: "SUBMITTED",
      classification: null,
      classificationRationale: null,
      submitterId: clientUser.id,
      submitterName: null,
      submitterEmail: null,
      unverifiedSubmitter: false,
      scopeCheckSuggestedIds: [],
      bundleId: null,
      amendmentVersionId: null,
      drawAllowancePoolId: null,
    });
    await tx.createImpact({
      changeRequestId: change.id,
      effortDays: 2,
      priceMinor: 120000,
      currency: "USD",
      timelineDays: 3,
      milestoneEffect: "Shifts launch by 3 days",
      risks: ["Testimonial copy may arrive late"],
      exclusions: [],
      notes: "Includes design + implementation",
      confidence: "HIGH",
      createdBy: owner.id,
    });
    console.log(`Seeded org=${org.id} project=${project.id} baseline=${baseline.id} change=${change.number}`);
  });

  if (store instanceof FileStore) store.flush();
  console.log("Seed complete. Log in with olivia@acme.test / password1234 (agency) or carl@client.test / password1234 (client).");
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

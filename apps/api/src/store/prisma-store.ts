import { Prisma, PrismaClient } from "@prisma/client";
import { DomainError, afterCursor, newId, paginate } from "@scopelock/domain";
import type { Store } from "./store.js";
import type {
  AIAnalysis,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalToken,
  Attachment,
  AuditEvent,
  Bundle,
  ChangeImpact,
  ChangeLink,
  ChangeRequest,
  ChangeStatus,
  Clarification,
  Client,
  DecisionNote,
  DeliveryEvidence,
  ExternalLink,
  IdempotencyRecord,
  Invitation,
  ListQuery,
  Membership,
  MetricEvent,
  Notification,
  Organization,
  OutboxEvent,
  PageResult,
  PasswordReset,
  Project,
  ProjectMember,
  Requirement,
  RequirementRevision,
  ScopeDocument,
  ScopeVersion,
  Session,
  UsageCounter,
  User,
} from "./types.js";
import { nowIso } from "./types.js";

type Db = PrismaClient | Prisma.TransactionClient;

const iso = (d: Date): string => d.toISOString();
const asDate = (s: string): Date => new Date(s);
function json<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  return v as T;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

function page<T extends { id: string; createdAt: string }>(rows: T[], q: ListQuery): PageResult<T> {
  const sorted = [...rows].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
  );
  return paginate(afterCursor(sorted, q.cursor), q.limit ?? 25);
}

// ---------- Row mappers (Prisma rows → store entities) ----------

function mapUser(r: Prisma.UserGetPayload<Prisma.UserDefaultArgs>): User {
  return { ...r, status: r.status as User["status"], createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}
function mapOrganization(r: Prisma.OrganizationGetPayload<Prisma.OrganizationDefaultArgs>): Organization {
  return {
    ...r,
    branding: json(r.branding, null),
    settings: json(r.settings, {}),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapMembership(r: Prisma.MembershipGetPayload<Prisma.MembershipDefaultArgs>): Membership {
  return { ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}
function mapInvitation(r: Prisma.InvitationGetPayload<Prisma.InvitationDefaultArgs>): Invitation {
  return {
    ...r,
    status: r.status as Invitation["status"],
    expiresAt: iso(r.expiresAt),
    createdAt: iso(r.createdAt),
    decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
  };
}
function mapSession(r: Prisma.SessionGetPayload<Prisma.SessionDefaultArgs>): Session {
  return { ...r, expiresAt: iso(r.expiresAt), createdAt: iso(r.createdAt), lastSeenAt: iso(r.lastSeenAt) };
}
function mapPasswordReset(r: Prisma.PasswordResetGetPayload<Prisma.PasswordResetDefaultArgs>): PasswordReset {
  return { ...r, expiresAt: iso(r.expiresAt), usedAt: r.usedAt ? iso(r.usedAt) : null, createdAt: iso(r.createdAt) };
}
function mapClient(r: Prisma.ClientGetPayload<Prisma.ClientDefaultArgs>): Client {
  return {
    ...r,
    contacts: json(r.contacts, []),
    deletedAt: r.deletedAt ? iso(r.deletedAt) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapProject(r: Prisma.ProjectGetPayload<Prisma.ProjectDefaultArgs>): Project {
  const settings = json<Record<string, unknown>>(r.settings, {});
  return {
    id: r.id,
    organizationId: r.organizationId,
    clientId: r.clientId,
    name: r.name,
    currency: r.currency,
    status: r.status,
    budgetMinor: r.budgetMinor,
    startDate: r.startDate ? iso(r.startDate) : null,
    targetDate: r.targetDate ? iso(r.targetDate) : null,
    settings: {
      aiEnabled: (settings.aiEnabled as boolean | undefined) ?? true,
      reminderHoursBeforeExpiry: (settings.reminderHoursBeforeExpiry as number[] | undefined) ?? [48, 24],
    },
    externalIntegrationsEnabled: r.externalIntegrationsEnabled,
    changeCounter: r.changeCounter,
    requirementCounter: r.requirementCounter,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapProjectMember(r: Prisma.ProjectMemberGetPayload<Prisma.ProjectMemberDefaultArgs>): ProjectMember {
  return { ...r, createdAt: iso(r.createdAt) };
}
function mapScopeDocument(r: Prisma.ScopeDocumentGetPayload<Prisma.ScopeDocumentDefaultArgs>): ScopeDocument {
  return { ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}
function mapScopeVersion(r: Prisma.ScopeVersionGetPayload<Prisma.ScopeVersionDefaultArgs>): ScopeVersion {
  return {
    ...r,
    assumptions: json(r.assumptions, []),
    exclusions: json(r.exclusions, []),
    publishedAt: r.publishedAt ? iso(r.publishedAt) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapRequirement(r: Prisma.RequirementGetPayload<Prisma.RequirementDefaultArgs>): Requirement {
  return { ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}
function mapRevision(r: Prisma.RequirementRevisionGetPayload<Prisma.RequirementRevisionDefaultArgs>): RequirementRevision {
  return { ...r, acceptanceCriteria: json(r.acceptanceCriteria, []), createdAt: iso(r.createdAt) };
}
function mapChange(r: Prisma.ChangeRequestGetPayload<Prisma.ChangeRequestDefaultArgs>): ChangeRequest {
  return {
    ...r,
    decidedAt: r.decidedAt ? iso(r.decidedAt) : null,
    implementedAt: r.implementedAt ? iso(r.implementedAt) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapImpact(r: Prisma.ChangeImpactGetPayload<Prisma.ChangeImpactDefaultArgs>): ChangeImpact {
  return {
    ...r,
    risks: json(r.risks, []),
    exclusions: json(r.exclusions, []),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapLink(r: Prisma.ChangeLinkGetPayload<Prisma.ChangeLinkDefaultArgs>): ChangeLink {
  return { ...r, targetType: r.targetType as ChangeLink["targetType"], createdAt: iso(r.createdAt) };
}
function mapClarification(r: Prisma.ClarificationGetPayload<Prisma.ClarificationDefaultArgs>): Clarification {
  return {
    ...r,
    askedAt: iso(r.askedAt),
    answeredAt: r.answeredAt ? iso(r.answeredAt) : null,
    createdAt: iso(r.askedAt),
  };
}
function mapBundle(r: Prisma.BundleGetPayload<Prisma.BundleDefaultArgs>): Bundle {
  return { ...r, createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}
function mapApproval(r: Prisma.ApprovalRequestGetPayload<Prisma.ApprovalRequestDefaultArgs>): ApprovalRequest {
  return {
    ...r,
    package: json(r.package, {}) as ApprovalRequest["package"],
    approverUserIds: json(r.approverUserIds, []),
    remindersSent: json(r.remindersSent, []),
    expiresAt: r.expiresAt ? iso(r.expiresAt) : null,
    sentAt: r.sentAt ? iso(r.sentAt) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapToken(r: Prisma.ApprovalTokenGetPayload<Prisma.ApprovalTokenDefaultArgs>): ApprovalToken {
  return {
    ...r,
    expiresAt: iso(r.expiresAt),
    revokedAt: r.revokedAt ? iso(r.revokedAt) : null,
    lastUsedAt: r.lastUsedAt ? iso(r.lastUsedAt) : null,
    createdAt: iso(r.createdAt),
  };
}
function mapDecision(r: Prisma.ApprovalDecisionGetPayload<Prisma.ApprovalDecisionDefaultArgs>): ApprovalDecision {
  return { ...r, createdAt: iso(r.createdAt) };
}
function mapAttachment(r: Prisma.AttachmentGetPayload<Prisma.AttachmentDefaultArgs>): Attachment {
  return { ...r, createdAt: iso(r.createdAt), completedAt: r.completedAt ? iso(r.completedAt) : null };
}
function mapEvidence(r: Prisma.DeliveryEvidenceGetPayload<Prisma.DeliveryEvidenceDefaultArgs>): DeliveryEvidence {
  return { ...r, verifiedAt: r.verifiedAt ? iso(r.verifiedAt) : null, createdAt: iso(r.createdAt) };
}
function mapNote(r: Prisma.DecisionNoteGetPayload<Prisma.DecisionNoteDefaultArgs>): DecisionNote {
  return { ...r, editHistory: json(r.editHistory, []), createdAt: iso(r.createdAt), updatedAt: iso(r.updatedAt) };
}
function mapAudit(r: Prisma.AuditEventGetPayload<Prisma.AuditEventDefaultArgs>): AuditEvent {
  return {
    ...r,
    before: r.before ?? undefined,
    after: r.after ?? undefined,
    createdAt: iso(r.createdAt),
  };
}
function mapNotification(r: Prisma.NotificationGetPayload<Prisma.NotificationDefaultArgs>): Notification {
  return { ...r, readAt: r.readAt ? iso(r.readAt) : null, createdAt: iso(r.createdAt) };
}
function mapOutbox(r: Prisma.OutboxEventGetPayload<Prisma.OutboxEventDefaultArgs>): OutboxEvent {
  return {
    ...r,
    payload: json(r.payload, {}),
    nextRunAt: iso(r.nextRunAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}
function mapAI(r: Prisma.AIAnalysisGetPayload<Prisma.AIAnalysisDefaultArgs>): AIAnalysis {
  const u = r.usage as { promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown } | null;
  const usage =
    u && typeof u.promptTokens === "number" && typeof u.completionTokens === "number" && typeof u.totalTokens === "number"
      ? { promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens }
      : null;
  return {
    ...r,
    inputRefs: json(r.inputRefs, {}),
    output: r.output ?? {},
    usage,
    createdAt: iso(r.createdAt),
  };
}
function mapExternal(r: Prisma.ExternalLinkGetPayload<Prisma.ExternalLinkDefaultArgs>): ExternalLink {
  return { ...r, createdAt: iso(r.createdAt) };
}
function mapMetric(r: Prisma.MetricEventGetPayload<Prisma.MetricEventDefaultArgs>): MetricEvent {
  return { ...r, properties: r.properties ?? undefined, createdAt: iso(r.createdAt) };
}
function mapIdempotency(r: Prisma.IdempotencyRecordGetPayload<Prisma.IdempotencyRecordDefaultArgs>): IdempotencyRecord {
  return { ...r, body: r.body ?? {}, createdAt: iso(r.createdAt), expiresAt: iso(r.expiresAt) };
}
function mapUsage(r: Prisma.UsageCounterGetPayload<Prisma.UsageCounterDefaultArgs>): UsageCounter {
  return {
    id: r.id,
    organizationId: r.organizationId,
    period: r.period,
    aiCalls: r.aiCalls,
    storageBytes: Number(r.storageBytes),
    emailsSent: r.emailsSent,
    projectsCreated: r.projectsCreated,
  };
}

const J = (v: unknown): Prisma.InputJsonValue => v as Prisma.InputJsonValue;

/** Newest-first keyset ordering shared by every list query. */
const ORDER_DESC: Array<{ createdAt?: Prisma.SortOrder; id?: Prisma.SortOrder }> = [
  { createdAt: "desc" },
  { id: "desc" },
];

/** PostgreSQL backend. All multi-write workflows run inside `transaction()`. */
export class PrismaStore implements Store {
  private readonly root: PrismaClient;
  private readonly db: Db;
  private readonly inTx: boolean;

  private constructor(root: PrismaClient, db: Db, inTx: boolean) {
    this.root = root;
    this.db = db;
    this.inTx = inTx;
  }

  static async connect(url: string): Promise<PrismaStore> {
    const client = new PrismaClient({ datasources: { db: { url } } });
    await client.$connect();
    return new PrismaStore(client, client, false);
  }

  async disconnect(): Promise<void> {
    await this.root.$disconnect();
  }

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    // Multi-statement domain transactions (publish, decision) issue 10-20+
    // sequential queries; over serverless Postgres (Neon) that exceeds
    // Prisma's 5s interactive-transaction default. 30s keeps large publishes
    // reliable without changing any semantics.
    return this.root.$transaction(async (tx) => fn(new PrismaStore(this.root, tx, true)), {
      maxWait: 10000,
      timeout: 30000,
    });
  }

  // ----- Users / sessions -----
  async createUser(data: Pick<User, "email" | "name" | "passwordHash">): Promise<User> {
    try {
      const r = await this.db.user.create({
        data: { id: newId("usr"), email: data.email.toLowerCase(), name: data.name, passwordHash: data.passwordHash },
      });
      return mapUser(r);
    } catch (err) {
      if (isUniqueViolation(err)) throw DomainError.conflict("An account with this email already exists");
      throw err;
    }
  }

  async findUserById(id: string): Promise<User | null> {
    const r = await this.db.user.findUnique({ where: { id } });
    return r ? mapUser(r) : null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const r = await this.db.user.findUnique({ where: { email: email.toLowerCase() } });
    return r ? mapUser(r) : null;
  }

  async updateUser(
    id: string,
    patch: Partial<Pick<User, "name" | "passwordHash" | "status" | "totpSecretEnc" | "mfaEnabled" | "mfaRecoveryHashes">>,
  ): Promise<User> {
    return mapUser(await this.db.user.update({ where: { id }, data: patch }));
  }

  async createSession(data: Pick<Session, "userId" | "tokenHash" | "expiresAt" | "ip">): Promise<Session> {
    return mapSession(
      await this.db.session.create({
        data: { id: newId("ses"), userId: data.userId, tokenHash: data.tokenHash, expiresAt: asDate(data.expiresAt), ip: data.ip },
      }),
    );
  }

  async findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    const r = await this.db.session.findUnique({ where: { tokenHash } });
    return r ? mapSession(r) : null;
  }

  async touchSession(id: string, lastSeenAt: string): Promise<void> {
    await this.db.session.update({ where: { id }, data: { lastSeenAt: asDate(lastSeenAt) } });
  }

  async deleteSession(id: string): Promise<void> {
    await this.db.session.deleteMany({ where: { id } });
  }

  async deleteUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const res = await this.db.session.deleteMany({
      where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    });
    return res.count;
  }

  async createPasswordReset(data: Pick<PasswordReset, "userId" | "tokenHash" | "expiresAt">): Promise<PasswordReset> {
    return mapPasswordReset(
      await this.db.passwordReset.create({
        data: { id: newId("pwr"), userId: data.userId, tokenHash: data.tokenHash, expiresAt: asDate(data.expiresAt) },
      }),
    );
  }

  async findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const r = await this.db.passwordReset.findUnique({ where: { tokenHash } });
    return r ? mapPasswordReset(r) : null;
  }

  async markPasswordResetUsed(id: string, usedAt: string): Promise<void> {
    await this.db.passwordReset.update({ where: { id }, data: { usedAt: asDate(usedAt) } });
  }

  // ----- Organizations / memberships / invitations -----
  async createOrganization(data: { name: string; plan?: Organization["plan"] }): Promise<Organization> {
    return mapOrganization(
      await this.db.organization.create({ data: { id: newId("org"), name: data.name, plan: data.plan ?? "FREE" } }),
    );
  }

  async findOrganizationById(id: string): Promise<Organization | null> {
    const r = await this.db.organization.findUnique({ where: { id } });
    return r ? mapOrganization(r) : null;
  }

  async listOrganizationsForUser(userId: string): Promise<Organization[]> {
    const rows = await this.db.membership.findMany({ where: { userId }, include: { organization: true } });
    return rows.map((m) => mapOrganization(m.organization));
  }

  async updateOrganization(id: string, patch: Partial<Organization>): Promise<Organization> {
    return mapOrganization(
      await this.db.organization.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
          ...(patch.aiEnabled !== undefined ? { aiEnabled: patch.aiEnabled } : {}),
          ...(patch.branding !== undefined ? { branding: patch.branding === null ? Prisma.JsonNull : J(patch.branding) } : {}),
          ...(patch.settings !== undefined ? { settings: J(patch.settings) } : {}),
        },
      }),
    );
  }

  async upsertMembership(organizationId: string, userId: string, role: Membership["role"]): Promise<Membership> {
    return mapMembership(
      await this.db.membership.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        create: { id: newId("mem"), organizationId, userId, role },
        update: { role },
      }),
    );
  }

  async findMembership(organizationId: string, userId: string): Promise<Membership | null> {
    const r = await this.db.membership.findUnique({ where: { organizationId_userId: { organizationId, userId } } });
    return r ? mapMembership(r) : null;
  }

  async listMemberships(organizationId: string): Promise<Membership[]> {
    return (await this.db.membership.findMany({ where: { organizationId } })).map(mapMembership);
  }

  async deleteMembership(organizationId: string, userId: string): Promise<void> {
    await this.db.membership.deleteMany({ where: { organizationId, userId } });
  }

  async createInvitation(
    data: Pick<Invitation, "organizationId" | "email" | "role" | "projectId" | "projectRole" | "tokenHash" | "expiresAt" | "createdBy">,
  ): Promise<Invitation> {
    return mapInvitation(
      await this.db.invitation.create({
        data: {
          id: newId("inv"),
          organizationId: data.organizationId,
          email: data.email.toLowerCase(),
          role: data.role,
          projectId: data.projectId,
          projectRole: data.projectRole,
          tokenHash: data.tokenHash,
          expiresAt: asDate(data.expiresAt),
          createdBy: data.createdBy,
        },
      }),
    );
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const r = await this.db.invitation.findUnique({ where: { tokenHash } });
    return r ? mapInvitation(r) : null;
  }

  async findInvitationById(id: string): Promise<Invitation | null> {
    const r = await this.db.invitation.findUnique({ where: { id } });
    return r ? mapInvitation(r) : null;
  }

  async listInvitations(organizationId: string): Promise<Invitation[]> {
    return (await this.db.invitation.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })).map(
      mapInvitation,
    );
  }

  async updateInvitation(id: string, patch: Partial<Invitation>): Promise<Invitation> {
    return mapInvitation(
      await this.db.invitation.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.decidedAt !== undefined ? { decidedAt: patch.decidedAt ? asDate(patch.decidedAt) : null } : {}),
          ...(patch.expiresAt !== undefined ? { expiresAt: asDate(patch.expiresAt) } : {}),
        },
      }),
    );
  }

  // ----- Clients / projects -----
  async createClient(data: Pick<Client, "organizationId" | "name" | "company" | "contacts" | "notes">): Promise<Client> {
    return mapClient(
      await this.db.client.create({
        data: { id: newId("cli"), organizationId: data.organizationId, name: data.name, company: data.company ?? null, contacts: J(data.contacts), notes: data.notes ?? null },
      }),
    );
  }

  async findClientById(id: string): Promise<Client | null> {
    const r = await this.db.client.findUnique({ where: { id } });
    return r ? mapClient(r) : null;
  }

  async listClients(organizationId: string): Promise<Client[]> {
    return (await this.db.client.findMany({ where: { organizationId, deletedAt: null } })).map(mapClient);
  }

  async updateClient(id: string, patch: Partial<Client>): Promise<Client> {
    return mapClient(
      await this.db.client.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.company !== undefined ? { company: patch.company } : {}),
          ...(patch.contacts !== undefined ? { contacts: J(patch.contacts) } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.deletedAt !== undefined ? { deletedAt: patch.deletedAt ? asDate(patch.deletedAt) : null } : {}),
        },
      }),
    );
  }

  async createProject(
    data: Pick<Project, "organizationId" | "clientId" | "name" | "currency" | "budgetMinor" | "startDate" | "targetDate" | "settings">,
  ): Promise<Project> {
    return mapProject(
      await this.db.project.create({
        data: {
          id: newId("prj"),
          organizationId: data.organizationId,
          clientId: data.clientId,
          name: data.name,
          currency: data.currency,
          budgetMinor: data.budgetMinor ?? null,
          startDate: data.startDate ? asDate(data.startDate) : null,
          targetDate: data.targetDate ? asDate(data.targetDate) : null,
          settings: J(data.settings),
        },
      }),
    );
  }

  async findProjectById(id: string): Promise<Project | null> {
    const r = await this.db.project.findUnique({ where: { id } });
    return r ? mapProject(r) : null;
  }

  async listProjects(organizationId: string): Promise<Project[]> {
    return (await this.db.project.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } })).map(mapProject);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    return mapProject(
      await this.db.project.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
          ...(patch.budgetMinor !== undefined ? { budgetMinor: patch.budgetMinor } : {}),
          ...(patch.startDate !== undefined ? { startDate: patch.startDate ? asDate(patch.startDate) : null } : {}),
          ...(patch.targetDate !== undefined ? { targetDate: patch.targetDate ? asDate(patch.targetDate) : null } : {}),
          ...(patch.settings !== undefined ? { settings: J(patch.settings) } : {}),
          ...(patch.externalIntegrationsEnabled !== undefined ? { externalIntegrationsEnabled: patch.externalIntegrationsEnabled } : {}),
        },
      }),
    );
  }

  async allocateChangeNumber(projectId: string): Promise<string> {
    const updated = await this.db.project.update({
      where: { id: projectId },
      data: { changeCounter: { increment: 1 } },
      select: { changeCounter: true },
    });
    return `CHG-${String(updated.changeCounter).padStart(3, "0")}`;
  }

  async allocateRequirementKey(projectId: string): Promise<string> {
    const updated = await this.db.project.update({
      where: { id: projectId },
      data: { requirementCounter: { increment: 1 } },
      select: { requirementCounter: true },
    });
    return `REQ-${String(updated.requirementCounter).padStart(3, "0")}`;
  }

  async upsertProjectMember(projectId: string, userId: string, role: ProjectMember["role"]): Promise<ProjectMember> {
    return mapProjectMember(
      await this.db.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { id: newId("pmb"), projectId, userId, role },
        update: { role },
      }),
    );
  }

  async findProjectMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    const r = await this.db.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
    return r ? mapProjectMember(r) : null;
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return (await this.db.projectMember.findMany({ where: { projectId } })).map(mapProjectMember);
  }

  async listProjectIdsForUser(userId: string): Promise<string[]> {
    return (await this.db.projectMember.findMany({ where: { userId }, select: { projectId: true } })).map((m) => m.projectId);
  }

  async deleteProjectMember(projectId: string, userId: string): Promise<void> {
    await this.db.projectMember.deleteMany({ where: { projectId, userId } });
  }

  // ----- Scope -----
  async createScopeDocument(projectId: string, name: string): Promise<ScopeDocument> {
    return mapScopeDocument(await this.db.scopeDocument.create({ data: { id: newId("sdoc"), projectId, name } }));
  }

  async findScopeDocumentById(id: string): Promise<ScopeDocument | null> {
    const r = await this.db.scopeDocument.findUnique({ where: { id } });
    return r ? mapScopeDocument(r) : null;
  }

  async listScopeDocuments(projectId: string): Promise<ScopeDocument[]> {
    return (await this.db.scopeDocument.findMany({ where: { projectId } })).map(mapScopeDocument);
  }

  async createScopeVersion(data: Omit<ScopeVersion, "id" | "sequence" | "createdAt" | "updatedAt">): Promise<ScopeVersion> {
    const last = await this.db.scopeVersion.findFirst({
      where: { scopeDocumentId: data.scopeDocumentId },
      orderBy: { sequence: "desc" },
      select: { sequence: true },
    });
    return mapScopeVersion(
      await this.db.scopeVersion.create({
        data: {
          id: newId("sver"),
          scopeDocumentId: data.scopeDocumentId,
          projectId: data.projectId,
          sequence: (last?.sequence ?? 0) + 1,
          status: data.status,
          title: data.title,
          summary: data.summary,
          assumptions: J(data.assumptions),
          exclusions: J(data.exclusions),
          version: data.version,
          publishedAt: data.publishedAt ? asDate(data.publishedAt) : null,
          publishedBy: data.publishedBy,
          createdBy: data.createdBy,
          supersedesId: data.supersedesId,
        },
      }),
    );
  }

  async findScopeVersionById(id: string): Promise<ScopeVersion | null> {
    const r = await this.db.scopeVersion.findUnique({ where: { id } });
    return r ? mapScopeVersion(r) : null;
  }

  async listScopeVersions(scopeDocumentId: string): Promise<ScopeVersion[]> {
    return (await this.db.scopeVersion.findMany({ where: { scopeDocumentId }, orderBy: { sequence: "asc" } })).map(
      mapScopeVersion,
    );
  }

  async listProjectScopeVersions(projectId: string): Promise<ScopeVersion[]> {
    return (await this.db.scopeVersion.findMany({ where: { projectId }, orderBy: { sequence: "asc" } })).map(
      mapScopeVersion,
    );
  }

  async updateScopeVersion(id: string, patch: Partial<ScopeVersion>): Promise<ScopeVersion> {
    return mapScopeVersion(
      await this.db.scopeVersion.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
          ...(patch.assumptions !== undefined ? { assumptions: J(patch.assumptions) } : {}),
          ...(patch.exclusions !== undefined ? { exclusions: J(patch.exclusions) } : {}),
          ...(patch.version !== undefined ? { version: patch.version } : {}),
          ...(patch.publishedAt !== undefined ? { publishedAt: patch.publishedAt ? asDate(patch.publishedAt) : null } : {}),
          ...(patch.publishedBy !== undefined ? { publishedBy: patch.publishedBy } : {}),
          ...(patch.supersedesId !== undefined ? { supersedesId: patch.supersedesId } : {}),
        },
      }),
    );
  }

  async createRequirement(projectId: string, stableKey: string): Promise<Requirement> {
    try {
      return mapRequirement(
        await this.db.requirement.create({ data: { id: newId("req"), projectId, stableKey } }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw DomainError.conflict(`Stable key ${stableKey} is already used in this project`);
      throw err;
    }
  }

  async findRequirementById(id: string): Promise<Requirement | null> {
    const r = await this.db.requirement.findUnique({ where: { id } });
    return r ? mapRequirement(r) : null;
  }

  async listRequirements(projectId: string): Promise<Requirement[]> {
    return (await this.db.requirement.findMany({ where: { projectId } })).map(mapRequirement);
  }

  async updateRequirement(id: string, patch: Partial<Requirement>): Promise<Requirement> {
    return mapRequirement(
      await this.db.requirement.update({
        where: { id },
        data: { ...(patch.status !== undefined ? { status: patch.status } : {}) },
      }),
    );
  }

  async upsertRevision(data: Omit<RequirementRevision, "id" | "createdAt">): Promise<RequirementRevision> {
    return mapRevision(
      await this.db.requirementRevision.upsert({
        where: { requirementId_scopeVersionId: { requirementId: data.requirementId, scopeVersionId: data.scopeVersionId } },
        create: {
          id: newId("rev"),
          requirementId: data.requirementId,
          scopeVersionId: data.scopeVersionId,
          title: data.title,
          description: data.description,
          acceptanceCriteria: J(data.acceptanceCriteria),
          category: data.category,
          priority: data.priority,
          order: data.order,
        },
        update: {
          title: data.title,
          description: data.description,
          acceptanceCriteria: J(data.acceptanceCriteria),
          category: data.category,
          priority: data.priority,
          order: data.order,
        },
      }),
    );
  }

  async listRevisionsByVersion(scopeVersionId: string): Promise<RequirementRevision[]> {
    return (
      await this.db.requirementRevision.findMany({
        where: { scopeVersionId },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      })
    ).map(mapRevision);
  }

  async deleteRevision(requirementId: string, scopeVersionId: string): Promise<void> {
    await this.db.requirementRevision.deleteMany({ where: { requirementId, scopeVersionId } });
  }

  // ----- Changes -----
  async createChange(
    data: Omit<ChangeRequest, "id" | "number" | "version" | "createdAt" | "updatedAt" | "decidedAt" | "implementedAt">,
  ): Promise<ChangeRequest> {
    const number = await this.allocateChangeNumber(data.projectId);
    return mapChange(
      await this.db.changeRequest.create({
        data: {
          id: newId("chg"),
          projectId: data.projectId,
          number,
          title: data.title,
          description: data.description,
          source: data.source,
          status: data.status,
          classification: data.classification,
          classificationRationale: data.classificationRationale,
          submitterId: data.submitterId,
          bundleId: data.bundleId,
          amendmentVersionId: data.amendmentVersionId,
        },
      }),
    );
  }

  async findChangeById(id: string): Promise<ChangeRequest | null> {
    const r = await this.db.changeRequest.findUnique({ where: { id } });
    return r ? mapChange(r) : null;
  }

  async listChanges(projectId: string, filter?: { status?: ChangeStatus[]; bundleId?: string | null }): Promise<ChangeRequest[]> {
    return (
      await this.db.changeRequest.findMany({
        where: {
          projectId,
          ...(filter?.status ? { status: { in: filter.status } } : {}),
          ...(filter?.bundleId !== undefined ? { bundleId: filter.bundleId } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    ).map(mapChange);
  }

  async updateChange(id: string, patch: Partial<ChangeRequest>): Promise<ChangeRequest> {
    return mapChange(
      await this.db.changeRequest.update({
        where: { id },
        data: {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.classification !== undefined ? { classification: patch.classification } : {}),
          ...(patch.classificationRationale !== undefined ? { classificationRationale: patch.classificationRationale } : {}),
          ...(patch.bundleId !== undefined ? { bundleId: patch.bundleId } : {}),
          ...(patch.version !== undefined ? { version: patch.version } : {}),
          ...(patch.decidedAt !== undefined ? { decidedAt: patch.decidedAt ? asDate(patch.decidedAt) : null } : {}),
          ...(patch.implementedAt !== undefined ? { implementedAt: patch.implementedAt ? asDate(patch.implementedAt) : null } : {}),
          ...(patch.amendmentVersionId !== undefined ? { amendmentVersionId: patch.amendmentVersionId } : {}),
        },
      }),
    );
  }

  async findLatestImpact(changeRequestId: string): Promise<ChangeImpact | null> {
    const r = await this.db.changeImpact.findFirst({ where: { changeRequestId }, orderBy: { version: "desc" } });
    return r ? mapImpact(r) : null;
  }

  async listImpacts(changeRequestId: string): Promise<ChangeImpact[]> {
    return (await this.db.changeImpact.findMany({ where: { changeRequestId }, orderBy: { version: "desc" } })).map(
      mapImpact,
    );
  }

  async createImpact(data: Omit<ChangeImpact, "id" | "version" | "createdAt" | "updatedAt">): Promise<ChangeImpact> {
    const latest = await this.findLatestImpact(data.changeRequestId);
    return mapImpact(
      await this.db.changeImpact.create({
        data: {
          id: newId("imp"),
          changeRequestId: data.changeRequestId,
          version: (latest?.version ?? -1) + 1,
          effortDays: data.effortDays,
          priceMinor: data.priceMinor,
          currency: data.currency,
          timelineDays: data.timelineDays,
          milestoneEffect: data.milestoneEffect,
          risks: J(data.risks),
          exclusions: J(data.exclusions),
          notes: data.notes,
          confidence: data.confidence,
          createdBy: data.createdBy,
        },
      }),
    );
  }

  async createChangeLink(data: Omit<ChangeLink, "id" | "createdAt">): Promise<ChangeLink> {
    return mapLink(
      await this.db.changeLink.create({
        data: {
          id: newId("lnk"),
          changeRequestId: data.changeRequestId,
          targetType: data.targetType,
          targetRequirementId: data.targetRequirementId,
          targetChangeId: data.targetChangeId,
          scopeVersionId: data.scopeVersionId,
          kind: data.kind,
          condition: data.condition,
          overrideRationale: data.overrideRationale,
          overrideBy: data.overrideBy,
          createdBy: data.createdBy,
        },
      }),
    );
  }

  async listChangeLinks(changeRequestId: string): Promise<ChangeLink[]> {
    return (await this.db.changeLink.findMany({ where: { changeRequestId } })).map(mapLink);
  }

  async deleteChangeLink(id: string): Promise<void> {
    await this.db.changeLink.deleteMany({ where: { id } });
  }

  async createClarification(data: Omit<Clarification, "id" | "createdAt" | "answeredAt" | "answeredBy" | "answer">): Promise<Clarification> {
    return mapClarification(
      await this.db.clarification.create({
        data: { id: newId("clr"), changeRequestId: data.changeRequestId, question: data.question, askedBy: data.askedBy },
      }),
    );
  }

  async listClarifications(changeRequestId: string): Promise<Clarification[]> {
    return (await this.db.clarification.findMany({ where: { changeRequestId }, orderBy: { askedAt: "asc" } })).map(
      mapClarification,
    );
  }

  async answerClarification(id: string, answer: string, answeredBy: string, answeredAt: string): Promise<Clarification> {
    return mapClarification(
      await this.db.clarification.update({ where: { id }, data: { answer, answeredBy, answeredAt: asDate(answeredAt) } }),
    );
  }

  // ----- Bundles -----
  async createBundle(data: Pick<Bundle, "projectId" | "name" | "adjustmentMinor" | "adjustmentNote" | "createdBy">): Promise<Bundle> {
    return mapBundle(
      await this.db.bundle.create({
        data: { id: newId("bdl"), projectId: data.projectId, name: data.name, adjustmentMinor: data.adjustmentMinor, adjustmentNote: data.adjustmentNote, createdBy: data.createdBy },
      }),
    );
  }

  async findBundleById(id: string): Promise<Bundle | null> {
    const r = await this.db.bundle.findUnique({ where: { id } });
    return r ? mapBundle(r) : null;
  }

  async listBundles(projectId: string): Promise<Bundle[]> {
    return (await this.db.bundle.findMany({ where: { projectId }, orderBy: { createdAt: "desc" } })).map(mapBundle);
  }

  async updateBundle(id: string, patch: Partial<Bundle>): Promise<Bundle> {
    return mapBundle(
      await this.db.bundle.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.adjustmentMinor !== undefined ? { adjustmentMinor: patch.adjustmentMinor } : {}),
          ...(patch.adjustmentNote !== undefined ? { adjustmentNote: patch.adjustmentNote } : {}),
        },
      }),
    );
  }

  // ----- Approvals -----
  async createApproval(data: Omit<ApprovalRequest, "id" | "createdAt" | "updatedAt">): Promise<ApprovalRequest> {
    return mapApproval(
      await this.db.approvalRequest.create({
        data: {
          id: newId("apr"),
          projectId: data.projectId,
          changeRequestId: data.changeRequestId,
          bundleId: data.bundleId,
          title: data.title,
          package: J(data.package),
          checksum: data.checksum,
          status: data.status,
          approverUserIds: J(data.approverUserIds),
          expiresAt: data.expiresAt ? asDate(data.expiresAt) : null,
          sentAt: data.sentAt ? asDate(data.sentAt) : null,
          sentBy: data.sentBy,
          createdBy: data.createdBy,
          invalidatedReason: data.invalidatedReason,
          supersededBy: data.supersededBy,
          remindersSent: J(data.remindersSent),
          version: data.version,
        },
      }),
    );
  }

  async findApprovalById(id: string): Promise<ApprovalRequest | null> {
    const r = await this.db.approvalRequest.findUnique({ where: { id } });
    return r ? mapApproval(r) : null;
  }

  async listApprovalsForChange(changeRequestId: string): Promise<ApprovalRequest[]> {
    const orderBy = ORDER_DESC;
    return (await this.db.approvalRequest.findMany({ where: { changeRequestId }, orderBy })).map(mapApproval);
  }

  async listApprovalsForBundle(bundleId: string): Promise<ApprovalRequest[]> {
    const orderBy = ORDER_DESC;
    return (await this.db.approvalRequest.findMany({ where: { bundleId }, orderBy })).map(mapApproval);
  }

  async listProjectApprovals(projectId: string): Promise<ApprovalRequest[]> {
    const orderBy = ORDER_DESC;
    return (await this.db.approvalRequest.findMany({ where: { projectId }, orderBy })).map(mapApproval);
  }

  async updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    return mapApproval(
      await this.db.approvalRequest.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.package !== undefined ? { package: J(patch.package) } : {}),
          ...(patch.checksum !== undefined ? { checksum: patch.checksum } : {}),
          ...(patch.approverUserIds !== undefined ? { approverUserIds: J(patch.approverUserIds) } : {}),
          ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt ? asDate(patch.expiresAt) : null } : {}),
          ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt ? asDate(patch.sentAt) : null } : {}),
          ...(patch.sentBy !== undefined ? { sentBy: patch.sentBy } : {}),
          ...(patch.invalidatedReason !== undefined ? { invalidatedReason: patch.invalidatedReason } : {}),
          ...(patch.supersededBy !== undefined ? { supersededBy: patch.supersededBy } : {}),
          ...(patch.remindersSent !== undefined ? { remindersSent: J(patch.remindersSent) } : {}),
          ...(patch.version !== undefined ? { version: patch.version } : {}),
        },
      }),
    );
  }

  async createApprovalToken(data: Omit<ApprovalToken, "id" | "createdAt" | "lastUsedAt" | "revokedAt">): Promise<ApprovalToken> {
    return mapToken(
      await this.db.approvalToken.create({
        data: {
          id: newId("apt"),
          approvalRequestId: data.approvalRequestId,
          tokenHash: data.tokenHash,
          approverEmail: data.approverEmail,
          approverUserId: data.approverUserId,
          expiresAt: asDate(data.expiresAt),
        },
      }),
    );
  }

  async findApprovalTokenByHash(tokenHash: string): Promise<ApprovalToken | null> {
    const r = await this.db.approvalToken.findUnique({ where: { tokenHash } });
    return r ? mapToken(r) : null;
  }

  async listApprovalTokens(approvalRequestId: string): Promise<ApprovalToken[]> {
    return (await this.db.approvalToken.findMany({ where: { approvalRequestId } })).map(mapToken);
  }

  async updateApprovalToken(id: string, patch: Partial<ApprovalToken>): Promise<ApprovalToken> {
    return mapToken(
      await this.db.approvalToken.update({
        where: { id },
        data: {
          ...(patch.revokedAt !== undefined ? { revokedAt: patch.revokedAt ? asDate(patch.revokedAt) : null } : {}),
          ...(patch.lastUsedAt !== undefined ? { lastUsedAt: patch.lastUsedAt ? asDate(patch.lastUsedAt) : null } : {}),
          ...(patch.expiresAt !== undefined ? { expiresAt: asDate(patch.expiresAt) } : {}),
        },
      }),
    );
  }

  async createDecision(data: Omit<ApprovalDecision, "id" | "createdAt">): Promise<ApprovalDecision> {
    return mapDecision(
      await this.db.approvalDecision.create({
        data: {
          id: newId("dec"),
          approvalRequestId: data.approvalRequestId,
          approverUserId: data.approverUserId,
          approverEmail: data.approverEmail,
          tokenId: data.tokenId,
          decision: data.decision,
          comment: data.comment,
          checksum: data.checksum,
          ip: data.ip,
          userAgent: data.userAgent,
        },
      }),
    );
  }

  async listDecisions(approvalRequestId: string): Promise<ApprovalDecision[]> {
    return (await this.db.approvalDecision.findMany({ where: { approvalRequestId } })).map(mapDecision);
  }

  // ----- Files / evidence -----
  async createAttachment(data: Omit<Attachment, "id" | "createdAt" | "completedAt">): Promise<Attachment> {
    return mapAttachment(
      await this.db.attachment.create({
        data: {
          id: newId("att"),
          projectId: data.projectId,
          ownerId: data.ownerId,
          fileName: data.fileName,
          contentType: data.contentType,
          sizeBytes: data.sizeBytes,
          checksum: data.checksum,
          storageKey: data.storageKey,
          status: data.status,
          linkedType: data.linkedType,
          linkedId: data.linkedId,
        },
      }),
    );
  }

  async findAttachmentById(id: string): Promise<Attachment | null> {
    const r = await this.db.attachment.findUnique({ where: { id } });
    return r ? mapAttachment(r) : null;
  }

  async listAttachments(projectId: string): Promise<Attachment[]> {
    const orderBy = ORDER_DESC;
    return (await this.db.attachment.findMany({ where: { projectId }, orderBy })).map(mapAttachment);
  }

  async listAttachmentsForGc(pendingBefore: string, deletedBefore: string): Promise<Attachment[]> {
    const rows = await this.db.attachment.findMany({
      where: {
        OR: [
          { status: "PENDING", createdAt: { lt: asDate(pendingBefore) } },
          {
            status: "DELETED",
            OR: [
              { completedAt: { lt: asDate(deletedBefore) } },
              { completedAt: null, createdAt: { lt: asDate(deletedBefore) } },
            ],
          },
        ],
      },
    });
    return rows.map(mapAttachment);
  }

  async updateAttachment(id: string, patch: Partial<Attachment>): Promise<Attachment> {
    return mapAttachment(
      await this.db.attachment.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.storageKey !== undefined ? { storageKey: patch.storageKey } : {}),
          ...(patch.checksum !== undefined ? { checksum: patch.checksum } : {}),
          ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt ? asDate(patch.completedAt) : null } : {}),
          ...(patch.linkedType !== undefined ? { linkedType: patch.linkedType } : {}),
          ...(patch.linkedId !== undefined ? { linkedId: patch.linkedId } : {}),
        },
      }),
    );
  }

  async createEvidence(data: Omit<DeliveryEvidence, "id" | "createdAt" | "verifiedAt" | "verifierId">): Promise<DeliveryEvidence> {
    return mapEvidence(
      await this.db.deliveryEvidence.create({
        data: {
          id: newId("evd"),
          requirementId: data.requirementId,
          projectId: data.projectId,
          type: data.type,
          title: data.title,
          url: data.url,
          attachmentId: data.attachmentId,
          note: data.note,
          status: data.status,
          authorId: data.authorId,
        },
      }),
    );
  }

  async findEvidenceById(id: string): Promise<DeliveryEvidence | null> {
    const r = await this.db.deliveryEvidence.findUnique({ where: { id } });
    return r ? mapEvidence(r) : null;
  }

  async listEvidenceForRequirement(requirementId: string): Promise<DeliveryEvidence[]> {
    return (await this.db.deliveryEvidence.findMany({ where: { requirementId } })).map(mapEvidence);
  }

  async updateEvidence(id: string, patch: Partial<DeliveryEvidence>): Promise<DeliveryEvidence> {
    return mapEvidence(
      await this.db.deliveryEvidence.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.verifierId !== undefined ? { verifierId: patch.verifierId } : {}),
          ...(patch.verifiedAt !== undefined ? { verifiedAt: patch.verifiedAt ? asDate(patch.verifiedAt) : null } : {}),
        },
      }),
    );
  }

  // ----- Notes / audit / activity -----
  async createDecisionNote(data: Pick<DecisionNote, "projectId" | "targetType" | "targetId" | "body" | "authorId">): Promise<DecisionNote> {
    return mapNote(
      await this.db.decisionNote.create({
        data: { id: newId("note"), projectId: data.projectId, targetType: data.targetType, targetId: data.targetId, body: data.body, authorId: data.authorId },
      }),
    );
  }

  async findDecisionNoteById(id: string): Promise<DecisionNote | null> {
    const r = await this.db.decisionNote.findUnique({ where: { id } });
    return r ? mapNote(r) : null;
  }

  async listDecisionNotes(projectId: string, filter?: { targetType?: string; targetId?: string }): Promise<DecisionNote[]> {
    const orderBy = ORDER_DESC;
    return (
      await this.db.decisionNote.findMany({
        where: {
          projectId,
          ...(filter?.targetType ? { targetType: filter.targetType } : {}),
          ...(filter?.targetId ? { targetId: filter.targetId } : {}),
        },
        orderBy,
      })
    ).map(mapNote);
  }

  async updateDecisionNote(id: string, patch: Partial<DecisionNote>): Promise<DecisionNote> {
    return mapNote(
      await this.db.decisionNote.update({
        where: { id },
        data: {
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.editHistory !== undefined ? { editHistory: J(patch.editHistory) } : {}),
        },
      }),
    );
  }

  async appendAuditEvent(data: Omit<AuditEvent, "id" | "createdAt">): Promise<AuditEvent> {
    return mapAudit(
      await this.db.auditEvent.create({
        data: {
          id: newId("aud"),
          organizationId: data.organizationId,
          projectId: data.projectId,
          actorId: data.actorId,
          actorEmail: data.actorEmail,
          action: data.action,
          targetType: data.targetType,
          targetId: data.targetId,
          before: data.before === undefined ? Prisma.JsonNull : J(data.before),
          after: data.after === undefined ? Prisma.JsonNull : J(data.after),
          correlationId: data.correlationId,
          ip: data.ip,
        },
      }),
    );
  }

  async listAuditEvents(
    filter: { organizationId?: string; projectId?: string; targetType?: string; targetId?: string } & ListQuery,
  ): Promise<PageResult<AuditEvent>> {
    const orderBy = ORDER_DESC;
    const rows = await this.db.auditEvent.findMany({
      where: {
        ...(filter.organizationId ? { organizationId: filter.organizationId } : {}),
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.targetType ? { targetType: filter.targetType } : {}),
        ...(filter.targetId ? { targetId: filter.targetId } : {}),
      },
      orderBy,
    });
    return page(rows.map(mapAudit), filter);
  }

  async listDecisionsWithContext(projectId: string, query?: string): Promise<ApprovalDecision[]> {
    const approvals = await this.db.approvalRequest.findMany({ where: { projectId }, select: { id: true } });
    const ids = approvals.map((a) => a.id);
    if (ids.length === 0) return [];
    const orderBy = ORDER_DESC;
    const rows = await this.db.approvalDecision.findMany({
      where: {
        approvalRequestId: { in: ids },
        ...(query
          ? { OR: [{ comment: { contains: query, mode: "insensitive" } }, { approverEmail: { contains: query, mode: "insensitive" } }] }
          : {}),
      },
      orderBy,
    });
    return rows.map(mapDecision);
  }

  // ----- Notifications / outbox -----
  async createNotification(data: Omit<Notification, "id" | "createdAt" | "readAt">): Promise<Notification> {
    return mapNotification(
      await this.db.notification.create({
        data: { id: newId("ntf"), userId: data.userId, projectId: data.projectId, type: data.type, title: data.title, body: data.body, link: data.link },
      }),
    );
  }

  async listNotifications(userId: string, query: ListQuery): Promise<PageResult<Notification>> {
    const orderBy = ORDER_DESC;
    const rows = await this.db.notification.findMany({ where: { userId }, orderBy });
    return page(rows.map(mapNotification), query);
  }

  async markNotification(id: string, userId: string, readAt: string | null): Promise<Notification | null> {
    const existing = await this.db.notification.findFirst({ where: { id, userId } });
    if (!existing) return null;
    return mapNotification(
      await this.db.notification.update({ where: { id }, data: { readAt: readAt ? asDate(readAt) : null } }),
    );
  }

  async enqueueOutbox(data: Pick<OutboxEvent, "type" | "payload" | "idempotencyKey">): Promise<OutboxEvent> {
    if (data.idempotencyKey) {
      const existing = await this.db.outboxEvent.findUnique({ where: { idempotencyKey: data.idempotencyKey } });
      if (existing) return mapOutbox(existing);
    }
    return mapOutbox(
      await this.db.outboxEvent.create({
        data: { id: newId("obx"), type: data.type, payload: J(data.payload), idempotencyKey: data.idempotencyKey },
      }),
    );
  }

  async claimOutboxBatch(limit: number, nowIsoValue: string): Promise<OutboxEvent[]> {
    const rows = await this.db.outboxEvent.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, nextRunAt: { lte: asDate(nowIsoValue) } },
      orderBy: { nextRunAt: "asc" },
      take: limit,
    });
    return rows.map(mapOutbox);
  }

  async updateOutbox(id: string, patch: Partial<OutboxEvent>): Promise<OutboxEvent> {
    return mapOutbox(
      await this.db.outboxEvent.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
          ...(patch.nextRunAt !== undefined ? { nextRunAt: asDate(patch.nextRunAt) } : {}),
          ...(patch.lastError !== undefined ? { lastError: patch.lastError } : {}),
        },
      }),
    );
  }

  // ----- AI / metrics / misc -----
  async createAIAnalysis(data: Omit<AIAnalysis, "id" | "createdAt">): Promise<AIAnalysis> {
    return mapAI(
      await this.db.aIAnalysis.create({
        data: {
          id: newId("aix"),
          projectId: data.projectId,
          changeRequestId: data.changeRequestId,
          kind: data.kind,
          inputRefs: J(data.inputRefs),
          model: data.model,
          promptVersion: data.promptVersion,
          output: J(data.output),
          status: data.status,
          usage: data.usage === null ? Prisma.JsonNull : J(data.usage),
          latencyMs: data.latencyMs,
          error: data.error,
          reviewerDisposition: data.reviewerDisposition,
          reviewedBy: data.reviewedBy,
          createdBy: data.createdBy,
        },
      }),
    );
  }

  async findAIAnalysisById(id: string): Promise<AIAnalysis | null> {
    const r = await this.db.aIAnalysis.findUnique({ where: { id } });
    return r ? mapAI(r) : null;
  }

  async listAIAnalyses(projectId: string): Promise<AIAnalysis[]> {
    const orderBy = ORDER_DESC;
    return (await this.db.aIAnalysis.findMany({ where: { projectId }, orderBy })).map(mapAI);
  }

  async updateAIAnalysis(id: string, patch: Partial<AIAnalysis>): Promise<AIAnalysis> {
    return mapAI(
      await this.db.aIAnalysis.update({
        where: { id },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.output !== undefined ? { output: J(patch.output) } : {}),
          ...(patch.latencyMs !== undefined ? { latencyMs: patch.latencyMs } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.reviewerDisposition !== undefined ? { reviewerDisposition: patch.reviewerDisposition } : {}),
          ...(patch.reviewedBy !== undefined ? { reviewedBy: patch.reviewedBy } : {}),
        },
      }),
    );
  }

  async recordMetric(data: Omit<MetricEvent, "id" | "createdAt">): Promise<MetricEvent> {
    return mapMetric(
      await this.db.metricEvent.create({
        data: {
          id: newId("met"),
          organizationId: data.organizationId,
          projectId: data.projectId,
          name: data.name,
          properties: data.properties === undefined ? Prisma.JsonNull : J(data.properties),
          actorId: data.actorId,
        },
      }),
    );
  }

  async listMetrics(projectId: string, name?: string): Promise<MetricEvent[]> {
    const orderBy = ORDER_DESC;
    return (
      await this.db.metricEvent.findMany({ where: { projectId, ...(name ? { name } : {}) }, orderBy })
    ).map(mapMetric);
  }

  async createExternalLink(data: Omit<ExternalLink, "id" | "createdAt">): Promise<ExternalLink> {
    try {
      return mapExternal(
        await this.db.externalLink.create({
          data: { id: newId("ext"), projectId: data.projectId, changeRequestId: data.changeRequestId, provider: data.provider, externalId: data.externalId, url: data.url, createdBy: data.createdBy },
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw DomainError.conflict("This external item is already linked");
      throw err;
    }
  }

  async findExternalLinkById(id: string): Promise<ExternalLink | null> {
    const r = await this.db.externalLink.findUnique({ where: { id } });
    return r ? mapExternal(r) : null;
  }

  async listExternalLinks(projectId: string): Promise<ExternalLink[]> {
    const orderBy = ORDER_DESC;
    return (await this.db.externalLink.findMany({ where: { projectId }, orderBy })).map(mapExternal);
  }

  async deleteExternalLink(id: string): Promise<void> {
    await this.db.externalLink.deleteMany({ where: { id } });
  }

  async findIdempotency(key: string, scope: string): Promise<IdempotencyRecord | null> {
    const r = await this.db.idempotencyRecord.findUnique({ where: { key_scope: { key, scope } } });
    return r ? mapIdempotency(r) : null;
  }

  async saveIdempotency(data: Omit<IdempotencyRecord, "id" | "createdAt">): Promise<IdempotencyRecord> {
    const existing = await this.findIdempotency(data.key, data.scope);
    if (existing) return existing;
    try {
      return mapIdempotency(
        await this.db.idempotencyRecord.create({
          data: { id: newId("idem"), key: data.key, scope: data.scope, statusCode: data.statusCode, body: J(data.body), expiresAt: asDate(data.expiresAt) },
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        const retry = await this.findIdempotency(data.key, data.scope);
        if (retry) return retry;
      }
      throw err;
    }
  }

  async getUsage(organizationId: string, period: string): Promise<UsageCounter> {
    const existing = await this.db.usageCounter.findUnique({
      where: { organizationId_period: { organizationId, period } },
    });
    if (existing) return mapUsage(existing);
    return mapUsage(
      await this.db.usageCounter.create({ data: { id: newId("use"), organizationId, period } }),
    );
  }

  async bumpUsage(
    organizationId: string,
    period: string,
    patch: Partial<Pick<UsageCounter, "aiCalls" | "storageBytes" | "emailsSent" | "projectsCreated">>,
  ): Promise<UsageCounter> {
    await this.getUsage(organizationId, period);
    return mapUsage(
      await this.db.usageCounter.update({
        where: { organizationId_period: { organizationId, period } },
        data: {
          ...(patch.aiCalls ? { aiCalls: { increment: patch.aiCalls } } : {}),
          ...(patch.storageBytes ? { storageBytes: { increment: BigInt(patch.storageBytes) } } : {}),
          ...(patch.emailsSent ? { emailsSent: { increment: patch.emailsSent } } : {}),
          ...(patch.projectsCreated ? { projectsCreated: { increment: patch.projectsCreated } } : {}),
        },
      }),
    );
  }

  async listInboxApprovals(userId: string, userEmail: string): Promise<ApprovalRequest[]> {
    const orderBy = ORDER_DESC;
    const tokens = await this.db.approvalToken.findMany({
      where: { revokedAt: null, OR: [{ approverUserId: userId }, { approverEmail: userEmail.toLowerCase() }] },
      select: { approvalRequestId: true },
    });
    const ids = tokens.map((t) => t.approvalRequestId);
    const rows = await this.db.approvalRequest.findMany({ where: { status: "SENT" }, orderBy });
    return rows
      .filter((a) => {
        const approvers = json<string[]>(a.approverUserIds, []);
        return approvers.includes(userId) || ids.includes(a.id);
      })
      .map(mapApproval);
  }

  async listExpiredPendingApprovals(nowIsoValue: string): Promise<ApprovalRequest[]> {
    return (
      await this.db.approvalRequest.findMany({
        where: { status: "SENT", expiresAt: { lte: asDate(nowIsoValue) } },
      })
    ).map(mapApproval);
  }

  async listApprovalsForReminders(nowIsoValue: string): Promise<ApprovalRequest[]> {
    return (
      await this.db.approvalRequest.findMany({
        where: { status: "SENT", expiresAt: { gt: asDate(nowIsoValue) } },
      })
    ).map(mapApproval);
  }
}

export { nowIso };


import { afterCursor, newId, paginate } from "@scopelock/domain";
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
  EstimateTemplate,
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
  RateCard,
  RateCardEntry,
  Requirement,
  RequirementRevision,
  ScopeDocument,
  ScopeVersion,
  Session,
  UsageCounter,
  User,
} from "./types.js";
import { currentPeriod, nowIso } from "./types.js";

type Tables = {
  users: Map<string, User>;
  organizations: Map<string, Organization>;
  memberships: Map<string, Membership>;
  invitations: Map<string, Invitation>;
  sessions: Map<string, Session>;
  passwordResets: Map<string, PasswordReset>;
  clients: Map<string, Client>;
  projects: Map<string, Project>;
  projectMembers: Map<string, ProjectMember>;
  scopeDocuments: Map<string, ScopeDocument>;
  scopeVersions: Map<string, ScopeVersion>;
  requirements: Map<string, Requirement>;
  revisions: Map<string, RequirementRevision>;
  changes: Map<string, ChangeRequest>;
  impacts: Map<string, ChangeImpact>;
  changeLinks: Map<string, ChangeLink>;
  clarifications: Map<string, Clarification>;
  rateCards: Map<string, RateCard>;
  estimateTemplates: Map<string, EstimateTemplate>;
  bundles: Map<string, Bundle>;
  approvals: Map<string, ApprovalRequest>;
  approvalTokens: Map<string, ApprovalToken>;
  decisions: Map<string, ApprovalDecision>;
  attachments: Map<string, Attachment>;
  evidence: Map<string, DeliveryEvidence>;
  decisionNotes: Map<string, DecisionNote>;
  auditEvents: Map<string, AuditEvent>;
  notifications: Map<string, Notification>;
  outbox: Map<string, OutboxEvent>;
  aiAnalyses: Map<string, AIAnalysis>;
  externalLinks: Map<string, ExternalLink>;
  metricEvents: Map<string, MetricEvent>;
  idempotency: Map<string, IdempotencyRecord>;
  usage: Map<string, UsageCounter>;
};

function emptyTables(): Tables {
  return {
    users: new Map(),
    organizations: new Map(),
    memberships: new Map(),
    invitations: new Map(),
    sessions: new Map(),
    passwordResets: new Map(),
    clients: new Map(),
    projects: new Map(),
    projectMembers: new Map(),
    scopeDocuments: new Map(),
    scopeVersions: new Map(),
    requirements: new Map(),
    revisions: new Map(),
    changes: new Map(),
    impacts: new Map(),
    changeLinks: new Map(),
    clarifications: new Map(),
    rateCards: new Map(),
    estimateTemplates: new Map(),
    bundles: new Map(),
    approvals: new Map(),
    approvalTokens: new Map(),
    decisions: new Map(),
    attachments: new Map(),
    evidence: new Map(),
    decisionNotes: new Map(),
    auditEvents: new Map(),
    notifications: new Map(),
    outbox: new Map(),
    aiAnalyses: new Map(),
    externalLinks: new Map(),
    metricEvents: new Map(),
    idempotency: new Map(),
    usage: new Map(),
  };
}

function sortDesc<T extends { id: string; createdAt: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
  );
}

function page<T extends { id: string; createdAt: string }>(rows: T[], q: ListQuery): PageResult<T> {
  return paginate(afterCursor(sortDesc(rows), q.cursor), q.limit ?? 25);
}

export class MemoryStore implements Store {
  protected tables: Tables = emptyTables();
  /** When true, transaction() runs the callback directly (nested tx). */
  protected inTransaction = false;
  private txQueue: Promise<unknown> = Promise.resolve();

  async transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T> {
    if (this.inTransaction) return fn(this);
    // Serialize top-level transactions so snapshot/rollback cannot interleave.
    const run = this.txQueue.then(async () => {
      const snapshot = structuredClone(this.tables);
      this.inTransaction = true;
      try {
        const result = await fn(this);
        this.inTransaction = false;
        this.afterCommit();
        return result;
      } catch (err) {
        this.tables = snapshot;
        this.inTransaction = false;
        throw err;
      }
    });
    this.txQueue = run.catch(() => undefined);
    return run;
  }

  /** Hook for the file-backed store to persist after top-level commits. */
  protected afterCommit(): void {
    // no-op for pure in-memory use
  }

  // ----- Users / sessions -----
  async createUser(data: Pick<User, "email" | "name" | "passwordHash">): Promise<User> {
    const now = nowIso();
    const user: User = {
      id: newId("usr"),
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash: data.passwordHash,
      status: "ACTIVE",
      totpSecretEnc: null,
      mfaEnabled: false,
      mfaRecoveryHashes: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tables.users.set(user.id, user);
    this.afterCommit();
    return user;
  }

  async findUserById(id: string): Promise<User | null> {
    return this.tables.users.get(id) ?? null;
  }

  async findUserByEmail(email: string): Promise<User | null> {
    const needle = email.toLowerCase();
    for (const u of this.tables.users.values()) if (u.email === needle) return u;
    return null;
  }

  async updateUser(
    id: string,
    patch: Partial<Pick<User, "name" | "passwordHash" | "status" | "totpSecretEnc" | "mfaEnabled" | "mfaRecoveryHashes">>,
  ): Promise<User> {
    const existing = this.tables.users.get(id);
    if (!existing) throw new Error(`User not found: ${id}`);
    const updated = { ...existing, ...patch, updatedAt: nowIso() };
    this.tables.users.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async createSession(data: Pick<Session, "userId" | "tokenHash" | "expiresAt" | "ip">): Promise<Session> {
    const now = nowIso();
    const session: Session = {
      id: newId("ses"),
      createdAt: now,
      lastSeenAt: now,
      ...data,
    };
    this.tables.sessions.set(session.id, session);
    this.afterCommit();
    return session;
  }

  async findSessionByTokenHash(tokenHash: string): Promise<Session | null> {
    for (const s of this.tables.sessions.values()) if (s.tokenHash === tokenHash) return s;
    return null;
  }

  async touchSession(id: string, lastSeenAt: string): Promise<void> {
    const s = this.tables.sessions.get(id);
    if (s) this.tables.sessions.set(id, { ...s, lastSeenAt });
  }

  async deleteSession(id: string): Promise<void> {
    this.tables.sessions.delete(id);
    this.afterCommit();
  }

  async deleteUserSessions(userId: string, exceptSessionId?: string): Promise<number> {
    let count = 0;
    for (const s of this.tables.sessions.values()) {
      if (s.userId === userId && s.id !== exceptSessionId) {
        this.tables.sessions.delete(s.id);
        count++;
      }
    }
    if (count > 0) this.afterCommit();
    return count;
  }

  async createPasswordReset(data: Pick<PasswordReset, "userId" | "tokenHash" | "expiresAt">): Promise<PasswordReset> {
    const row: PasswordReset = { id: newId("pwr"), usedAt: null, createdAt: nowIso(), ...data };
    this.tables.passwordResets.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    for (const r of this.tables.passwordResets.values()) if (r.tokenHash === tokenHash) return r;
    return null;
  }

  async markPasswordResetUsed(id: string, usedAt: string): Promise<void> {
    const r = this.tables.passwordResets.get(id);
    if (r) {
      this.tables.passwordResets.set(id, { ...r, usedAt });
      this.afterCommit();
    }
  }

  // ----- Organizations / memberships / invitations -----
  async createOrganization(data: { name: string; plan?: Organization["plan"] }): Promise<Organization> {
    const now = nowIso();
    const org: Organization = {
      id: newId("org"),
      name: data.name,
      plan: data.plan ?? "FREE",
      aiEnabled: true,
      branding: null,
      settings: {},
      createdAt: now,
      updatedAt: now,
    };
    this.tables.organizations.set(org.id, org);
    this.afterCommit();
    return org;
  }

  async findOrganizationById(id: string): Promise<Organization | null> {
    return this.tables.organizations.get(id) ?? null;
  }

  async listOrganizationsForUser(userId: string): Promise<Organization[]> {
    const orgIds = new Set(
      [...this.tables.memberships.values()].filter((m) => m.userId === userId).map((m) => m.organizationId),
    );
    return [...this.tables.organizations.values()].filter((o) => orgIds.has(o.id));
  }

  async updateOrganization(id: string, patch: Partial<Organization>): Promise<Organization> {
    const existing = this.tables.organizations.get(id);
    if (!existing) throw new Error(`Organization not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.organizations.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async upsertMembership(organizationId: string, userId: string, role: Membership["role"]): Promise<Membership> {
    for (const m of this.tables.memberships.values()) {
      if (m.organizationId === organizationId && m.userId === userId) {
        const updated = { ...m, role, updatedAt: nowIso() };
        this.tables.memberships.set(m.id, updated);
        this.afterCommit();
        return updated;
      }
    }
    const now = nowIso();
    const row: Membership = { id: newId("mem"), organizationId, userId, role, createdAt: now, updatedAt: now };
    this.tables.memberships.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findMembership(organizationId: string, userId: string): Promise<Membership | null> {
    for (const m of this.tables.memberships.values()) {
      if (m.organizationId === organizationId && m.userId === userId) return m;
    }
    return null;
  }

  async listMemberships(organizationId: string): Promise<Membership[]> {
    return [...this.tables.memberships.values()].filter((m) => m.organizationId === organizationId);
  }

  async deleteMembership(organizationId: string, userId: string): Promise<void> {
    for (const m of this.tables.memberships.values()) {
      if (m.organizationId === organizationId && m.userId === userId) this.tables.memberships.delete(m.id);
    }
    this.afterCommit();
  }

  async createInvitation(
    data: Pick<Invitation, "organizationId" | "email" | "role" | "projectId" | "projectRole" | "tokenHash" | "expiresAt" | "createdBy">,
  ): Promise<Invitation> {
    const row: Invitation = {
      id: newId("inv"),
      status: "PENDING",
      createdAt: nowIso(),
      decidedAt: null,
      ...data,
      email: data.email.toLowerCase(),
    };
    this.tables.invitations.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<Invitation | null> {
    for (const i of this.tables.invitations.values()) if (i.tokenHash === tokenHash) return i;
    return null;
  }

  async findInvitationById(id: string): Promise<Invitation | null> {
    return this.tables.invitations.get(id) ?? null;
  }

  async listInvitations(organizationId: string): Promise<Invitation[]> {
    return sortDesc(
      [...this.tables.invitations.values()].filter((i) => i.organizationId === organizationId),
    );
  }

  async updateInvitation(id: string, patch: Partial<Invitation>): Promise<Invitation> {
    const existing = this.tables.invitations.get(id);
    if (!existing) throw new Error(`Invitation not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.tables.invitations.set(id, updated);
    this.afterCommit();
    return updated;
  }

  // ----- Clients / projects -----
  async createClient(data: Pick<Client, "organizationId" | "name" | "company" | "contacts" | "notes">): Promise<Client> {
    const now = nowIso();
    const row: Client = {
      id: newId("cli"),
      company: data.company ?? null,
      notes: data.notes ?? null,
      contacts: data.contacts,
      organizationId: data.organizationId,
      name: data.name,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tables.clients.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findClientById(id: string): Promise<Client | null> {
    return this.tables.clients.get(id) ?? null;
  }

  async listClients(organizationId: string): Promise<Client[]> {
    return [...this.tables.clients.values()].filter(
      (c) => c.organizationId === organizationId && c.deletedAt === null,
    );
  }

  async updateClient(id: string, patch: Partial<Client>): Promise<Client> {
    const existing = this.tables.clients.get(id);
    if (!existing) throw new Error(`Client not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.clients.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async createProject(
    data: Pick<Project, "organizationId" | "clientId" | "name" | "currency" | "budgetMinor" | "startDate" | "targetDate" | "settings">,
  ): Promise<Project> {
    const now = nowIso();
    const row: Project = {
      id: newId("prj"),
      status: "DRAFT",
      externalIntegrationsEnabled: false,
      changeCounter: 0,
      requirementCounter: 0,
      budgetMinor: data.budgetMinor ?? null,
      startDate: data.startDate ?? null,
      targetDate: data.targetDate ?? null,
      organizationId: data.organizationId,
      clientId: data.clientId,
      name: data.name,
      currency: data.currency,
      settings: data.settings,
      createdAt: now,
      updatedAt: now,
    };
    this.tables.projects.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findProjectById(id: string): Promise<Project | null> {
    return this.tables.projects.get(id) ?? null;
  }

  async listProjects(organizationId: string): Promise<Project[]> {
    return [...this.tables.projects.values()].filter((p) => p.organizationId === organizationId);
  }

  async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const existing = this.tables.projects.get(id);
    if (!existing) throw new Error(`Project not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.projects.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async allocateChangeNumber(projectId: string): Promise<string> {
    const project = this.tables.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const next = project.changeCounter + 1;
    this.tables.projects.set(projectId, { ...project, changeCounter: next, updatedAt: nowIso() });
    return `CHG-${String(next).padStart(3, "0")}`;
  }

  async allocateRequirementKey(projectId: string): Promise<string> {
    const project = this.tables.projects.get(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);
    const next = project.requirementCounter + 1;
    this.tables.projects.set(projectId, { ...project, requirementCounter: next, updatedAt: nowIso() });
    return `REQ-${String(next).padStart(3, "0")}`;
  }

  async upsertProjectMember(projectId: string, userId: string, role: ProjectMember["role"]): Promise<ProjectMember> {
    for (const m of this.tables.projectMembers.values()) {
      if (m.projectId === projectId && m.userId === userId) {
        const updated = { ...m, role };
        this.tables.projectMembers.set(m.id, updated);
        this.afterCommit();
        return updated;
      }
    }
    const row: ProjectMember = { id: newId("pmb"), projectId, userId, role, createdAt: nowIso() };
    this.tables.projectMembers.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findProjectMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    for (const m of this.tables.projectMembers.values()) {
      if (m.projectId === projectId && m.userId === userId) return m;
    }
    return null;
  }

  async listProjectMembers(projectId: string): Promise<ProjectMember[]> {
    return [...this.tables.projectMembers.values()].filter((m) => m.projectId === projectId);
  }

  async listProjectIdsForUser(userId: string): Promise<string[]> {
    return [...this.tables.projectMembers.values()]
      .filter((m) => m.userId === userId)
      .map((m) => m.projectId);
  }

  async deleteProjectMember(projectId: string, userId: string): Promise<void> {
    for (const m of this.tables.projectMembers.values()) {
      if (m.projectId === projectId && m.userId === userId) this.tables.projectMembers.delete(m.id);
    }
    this.afterCommit();
  }

  // ----- Scope -----
  async createScopeDocument(projectId: string, name: string): Promise<ScopeDocument> {
    const now = nowIso();
    const row: ScopeDocument = { id: newId("sdoc"), projectId, name, createdAt: now, updatedAt: now };
    this.tables.scopeDocuments.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findScopeDocumentById(id: string): Promise<ScopeDocument | null> {
    return this.tables.scopeDocuments.get(id) ?? null;
  }

  async listScopeDocuments(projectId: string): Promise<ScopeDocument[]> {
    return [...this.tables.scopeDocuments.values()].filter((d) => d.projectId === projectId);
  }

  async createScopeVersion(data: Omit<ScopeVersion, "id" | "sequence" | "createdAt" | "updatedAt">): Promise<ScopeVersion> {
    const siblings = [...this.tables.scopeVersions.values()].filter(
      (v) => v.scopeDocumentId === data.scopeDocumentId,
    );
    const sequence = siblings.length === 0 ? 1 : Math.max(...siblings.map((v) => v.sequence)) + 1;
    const now = nowIso();
    const row: ScopeVersion = { id: newId("sver"), sequence, createdAt: now, updatedAt: now, ...data };
    this.tables.scopeVersions.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findScopeVersionById(id: string): Promise<ScopeVersion | null> {
    return this.tables.scopeVersions.get(id) ?? null;
  }

  async listScopeVersions(scopeDocumentId: string): Promise<ScopeVersion[]> {
    return [...this.tables.scopeVersions.values()]
      .filter((v) => v.scopeDocumentId === scopeDocumentId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async listProjectScopeVersions(projectId: string): Promise<ScopeVersion[]> {
    return [...this.tables.scopeVersions.values()]
      .filter((v) => v.projectId === projectId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async updateScopeVersion(id: string, patch: Partial<ScopeVersion>): Promise<ScopeVersion> {
    const existing = this.tables.scopeVersions.get(id);
    if (!existing) throw new Error(`Scope version not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.scopeVersions.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async createRequirement(projectId: string, stableKey: string): Promise<Requirement> {
    const now = nowIso();
    const row: Requirement = { id: newId("req"), projectId, stableKey, status: "PROPOSED", createdAt: now, updatedAt: now };
    this.tables.requirements.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findRequirementById(id: string): Promise<Requirement | null> {
    return this.tables.requirements.get(id) ?? null;
  }

  async listRequirements(projectId: string): Promise<Requirement[]> {
    return [...this.tables.requirements.values()].filter((r) => r.projectId === projectId);
  }

  async updateRequirement(id: string, patch: Partial<Requirement>): Promise<Requirement> {
    const existing = this.tables.requirements.get(id);
    if (!existing) throw new Error(`Requirement not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.requirements.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async upsertRevision(data: Omit<RequirementRevision, "id" | "createdAt">): Promise<RequirementRevision> {
    for (const r of this.tables.revisions.values()) {
      if (r.requirementId === data.requirementId && r.scopeVersionId === data.scopeVersionId) {
        const updated = { ...r, ...data, id: r.id };
        this.tables.revisions.set(r.id, updated);
        this.afterCommit();
        return updated;
      }
    }
    const row: RequirementRevision = { id: newId("rev"), createdAt: nowIso(), ...data };
    this.tables.revisions.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listRevisionsByVersion(scopeVersionId: string): Promise<RequirementRevision[]> {
    return [...this.tables.revisions.values()]
      .filter((r) => r.scopeVersionId === scopeVersionId)
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }

  async deleteRevision(requirementId: string, scopeVersionId: string): Promise<void> {
    for (const r of this.tables.revisions.values()) {
      if (r.requirementId === requirementId && r.scopeVersionId === scopeVersionId) {
        this.tables.revisions.delete(r.id);
      }
    }
    this.afterCommit();
  }

  // ----- Changes -----
  async createChange(
    data: Omit<ChangeRequest, "id" | "number" | "version" | "createdAt" | "updatedAt" | "decidedAt" | "implementedAt">,
  ): Promise<ChangeRequest> {
    const number = await this.allocateChangeNumber(data.projectId);
    const now = nowIso();
    const row: ChangeRequest = {
      id: newId("chg"),
      number,
      version: 0,
      decidedAt: null,
      implementedAt: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.tables.changes.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findChangeById(id: string): Promise<ChangeRequest | null> {
    return this.tables.changes.get(id) ?? null;
  }

  async listChanges(projectId: string, filter?: { status?: ChangeStatus[]; bundleId?: string | null }): Promise<ChangeRequest[]> {
    return sortDesc(
      [...this.tables.changes.values()].filter(
        (c) =>
          c.projectId === projectId &&
          (!filter?.status || filter.status.includes(c.status)) &&
          (filter?.bundleId === undefined || c.bundleId === filter.bundleId),
      ),
    );
  }

  async updateChange(id: string, patch: Partial<ChangeRequest>): Promise<ChangeRequest> {
    const existing = this.tables.changes.get(id);
    if (!existing) throw new Error(`Change not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.changes.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async findLatestImpact(changeRequestId: string): Promise<ChangeImpact | null> {
    const all = [...this.tables.impacts.values()]
      .filter((i) => i.changeRequestId === changeRequestId)
      .sort((a, b) => b.version - a.version);
    return all[0] ?? null;
  }

  async listImpacts(changeRequestId: string): Promise<ChangeImpact[]> {
    return [...this.tables.impacts.values()]
      .filter((i) => i.changeRequestId === changeRequestId)
      .sort((a, b) => b.version - a.version);
  }

  async createImpact(data: Omit<ChangeImpact, "id" | "version" | "createdAt" | "updatedAt">): Promise<ChangeImpact> {
    const latest = await this.findLatestImpact(data.changeRequestId);
    const now = nowIso();
    const row: ChangeImpact = { id: newId("imp"), version: (latest?.version ?? -1) + 1, createdAt: now, updatedAt: now, ...data };
    this.tables.impacts.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async createChangeLink(data: Omit<ChangeLink, "id" | "createdAt">): Promise<ChangeLink> {
    const row: ChangeLink = { id: newId("lnk"), createdAt: nowIso(), ...data };
    this.tables.changeLinks.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listChangeLinks(changeRequestId: string): Promise<ChangeLink[]> {
    return [...this.tables.changeLinks.values()].filter((l) => l.changeRequestId === changeRequestId);
  }

  async deleteChangeLink(id: string): Promise<void> {
    this.tables.changeLinks.delete(id);
    this.afterCommit();
  }

  async createClarification(data: Omit<Clarification, "id" | "createdAt" | "answeredAt" | "answeredBy" | "answer">): Promise<Clarification> {
    const now = nowIso();
    const row: Clarification = { id: newId("clr"), answer: null, answeredBy: null, answeredAt: null, createdAt: now, ...data };
    this.tables.clarifications.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listClarifications(changeRequestId: string): Promise<Clarification[]> {
    return [...this.tables.clarifications.values()]
      .filter((c) => c.changeRequestId === changeRequestId)
      .sort((a, b) => (a.askedAt < b.askedAt ? -1 : 1));
  }

  async answerClarification(id: string, answer: string, answeredBy: string, answeredAt: string): Promise<Clarification> {
    const existing = this.tables.clarifications.get(id);
    if (!existing) throw new Error(`Clarification not found: ${id}`);
    const updated = { ...existing, answer, answeredBy, answeredAt };
    this.tables.clarifications.set(id, updated);
    this.afterCommit();
    return updated;
  }

  // ----- Rate cards / estimate templates -----
  async createRateCard(data: {
    organizationId: string;
    name: string;
    currency: string;
    isDefault: boolean;
    createdBy: string;
    rates: Array<{ role: string; hourlyRateMinor: number }>;
  }): Promise<RateCard> {
    const now = nowIso();
    const id = newId("rc");
    const row: RateCard = {
      id,
      organizationId: data.organizationId,
      name: data.name,
      currency: data.currency,
      isDefault: data.isDefault,
      rates: data.rates.map(
        (r): RateCardEntry => ({ id: newId("rce"), rateCardId: id, role: r.role, hourlyRateMinor: r.hourlyRateMinor }),
      ),
      createdBy: data.createdBy,
      createdAt: now,
      updatedAt: now,
    };
    this.tables.rateCards.set(id, row);
    this.afterCommit();
    return row;
  }

  async findRateCardById(id: string): Promise<RateCard | null> {
    return this.tables.rateCards.get(id) ?? null;
  }

  async listRateCards(organizationId: string): Promise<RateCard[]> {
    return [...this.tables.rateCards.values()].filter((c) => c.organizationId === organizationId);
  }

  async updateRateCard(
    id: string,
    patch: Partial<Pick<RateCard, "name" | "currency" | "isDefault">> & { rates?: Array<{ role: string; hourlyRateMinor: number }> },
  ): Promise<RateCard> {
    const existing = this.tables.rateCards.get(id);
    if (!existing) throw new Error(`Rate card not found: ${id}`);
    const updated: RateCard = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.isDefault !== undefined ? { isDefault: patch.isDefault } : {}),
      ...(patch.rates !== undefined
        ? { rates: patch.rates.map((r): RateCardEntry => ({ id: newId("rce"), rateCardId: id, role: r.role, hourlyRateMinor: r.hourlyRateMinor })) }
        : {}),
      id,
      updatedAt: nowIso(),
    };
    this.tables.rateCards.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async deleteRateCard(id: string): Promise<void> {
    this.tables.rateCards.delete(id);
    this.afterCommit();
  }

  async createEstimateTemplate(data: {
    organizationId: string;
    name: string;
    items: EstimateTemplate["items"];
    contingencyPct: number;
    taxPct: number | null;
    createdBy: string;
  }): Promise<EstimateTemplate> {
    const now = nowIso();
    const row: EstimateTemplate = { id: newId("et"), createdAt: now, updatedAt: now, ...data };
    this.tables.estimateTemplates.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findEstimateTemplateById(id: string): Promise<EstimateTemplate | null> {
    return this.tables.estimateTemplates.get(id) ?? null;
  }

  async listEstimateTemplates(organizationId: string): Promise<EstimateTemplate[]> {
    return [...this.tables.estimateTemplates.values()].filter((tpl) => tpl.organizationId === organizationId);
  }

  async updateEstimateTemplate(
    id: string,
    patch: Partial<Pick<EstimateTemplate, "name" | "items" | "contingencyPct" | "taxPct">>,
  ): Promise<EstimateTemplate> {
    const existing = this.tables.estimateTemplates.get(id);
    if (!existing) throw new Error(`Estimate template not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.estimateTemplates.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async deleteEstimateTemplate(id: string): Promise<void> {
    this.tables.estimateTemplates.delete(id);
    this.afterCommit();
  }

  async countImpactsByRateCard(rateCardId: string): Promise<number> {
    return [...this.tables.impacts.values()].filter((i) => i.rateCardId === rateCardId).length;
  }

  // ----- Bundles -----
  async createBundle(data: Pick<Bundle, "projectId" | "name" | "adjustmentMinor" | "adjustmentNote" | "createdBy">): Promise<Bundle> {
    const now = nowIso();
    const row: Bundle = { id: newId("bdl"), status: "DRAFT", createdAt: now, updatedAt: now, ...data };
    this.tables.bundles.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findBundleById(id: string): Promise<Bundle | null> {
    return this.tables.bundles.get(id) ?? null;
  }

  async listBundles(projectId: string): Promise<Bundle[]> {
    return sortDesc([...this.tables.bundles.values()].filter((b) => b.projectId === projectId));
  }

  async updateBundle(id: string, patch: Partial<Bundle>): Promise<Bundle> {
    const existing = this.tables.bundles.get(id);
    if (!existing) throw new Error(`Bundle not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.bundles.set(id, updated);
    this.afterCommit();
    return updated;
  }

  // ----- Approvals -----
  async createApproval(data: Omit<ApprovalRequest, "id" | "createdAt" | "updatedAt">): Promise<ApprovalRequest> {
    const now = nowIso();
    const row: ApprovalRequest = { id: newId("apr"), createdAt: now, updatedAt: now, ...data };
    this.tables.approvals.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findApprovalById(id: string): Promise<ApprovalRequest | null> {
    return this.tables.approvals.get(id) ?? null;
  }

  async listApprovalsForChange(changeRequestId: string): Promise<ApprovalRequest[]> {
    return sortDesc([...this.tables.approvals.values()].filter((a) => a.changeRequestId === changeRequestId));
  }

  async listApprovalsForBundle(bundleId: string): Promise<ApprovalRequest[]> {
    return sortDesc([...this.tables.approvals.values()].filter((a) => a.bundleId === bundleId));
  }

  async listProjectApprovals(projectId: string): Promise<ApprovalRequest[]> {
    return sortDesc([...this.tables.approvals.values()].filter((a) => a.projectId === projectId));
  }

  async updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest> {
    const existing = this.tables.approvals.get(id);
    if (!existing) throw new Error(`Approval not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.approvals.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async createApprovalToken(data: Omit<ApprovalToken, "id" | "createdAt" | "lastUsedAt" | "revokedAt">): Promise<ApprovalToken> {
    const row: ApprovalToken = { id: newId("apt"), createdAt: nowIso(), lastUsedAt: null, revokedAt: null, ...data };
    this.tables.approvalTokens.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findApprovalTokenByHash(tokenHash: string): Promise<ApprovalToken | null> {
    for (const t of this.tables.approvalTokens.values()) if (t.tokenHash === tokenHash) return t;
    return null;
  }

  async listApprovalTokens(approvalRequestId: string): Promise<ApprovalToken[]> {
    return [...this.tables.approvalTokens.values()].filter((t) => t.approvalRequestId === approvalRequestId);
  }

  async updateApprovalToken(id: string, patch: Partial<ApprovalToken>): Promise<ApprovalToken> {
    const existing = this.tables.approvalTokens.get(id);
    if (!existing) throw new Error(`Approval token not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.tables.approvalTokens.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async createDecision(data: Omit<ApprovalDecision, "id" | "createdAt">): Promise<ApprovalDecision> {
    const row: ApprovalDecision = { id: newId("dec"), createdAt: nowIso(), ...data };
    this.tables.decisions.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listDecisions(approvalRequestId: string): Promise<ApprovalDecision[]> {
    return [...this.tables.decisions.values()].filter((d) => d.approvalRequestId === approvalRequestId);
  }

  // ----- Files / evidence -----
  async createAttachment(data: Omit<Attachment, "id" | "createdAt" | "completedAt">): Promise<Attachment> {
    const row: Attachment = { id: newId("att"), createdAt: nowIso(), completedAt: null, ...data };
    this.tables.attachments.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findAttachmentById(id: string): Promise<Attachment | null> {
    return this.tables.attachments.get(id) ?? null;
  }

  async listAttachments(projectId: string): Promise<Attachment[]> {
    return sortDesc([...this.tables.attachments.values()].filter((a) => a.projectId === projectId));
  }

  async listAttachmentsForGc(pendingBefore: string, deletedBefore: string): Promise<Attachment[]> {
    return [...this.tables.attachments.values()].filter(
      (a) =>
        (a.status === "PENDING" && a.createdAt < pendingBefore) ||
        (a.status === "DELETED" && (a.completedAt ?? a.createdAt) < deletedBefore),
    );
  }

  async updateAttachment(id: string, patch: Partial<Attachment>): Promise<Attachment> {
    const existing = this.tables.attachments.get(id);
    if (!existing) throw new Error(`Attachment not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.tables.attachments.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async createEvidence(data: Omit<DeliveryEvidence, "id" | "createdAt" | "verifiedAt" | "verifierId">): Promise<DeliveryEvidence> {
    const row: DeliveryEvidence = { id: newId("evd"), createdAt: nowIso(), verifiedAt: null, verifierId: null, ...data };
    this.tables.evidence.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findEvidenceById(id: string): Promise<DeliveryEvidence | null> {
    return this.tables.evidence.get(id) ?? null;
  }

  async listEvidenceForRequirement(requirementId: string): Promise<DeliveryEvidence[]> {
    return [...this.tables.evidence.values()].filter((e) => e.requirementId === requirementId);
  }

  async updateEvidence(id: string, patch: Partial<DeliveryEvidence>): Promise<DeliveryEvidence> {
    const existing = this.tables.evidence.get(id);
    if (!existing) throw new Error(`Evidence not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.tables.evidence.set(id, updated);
    this.afterCommit();
    return updated;
  }

  // ----- Notes / audit / activity -----
  async createDecisionNote(data: Pick<DecisionNote, "projectId" | "targetType" | "targetId" | "body" | "authorId">): Promise<DecisionNote> {
    const now = nowIso();
    const row: DecisionNote = { id: newId("note"), editHistory: [], createdAt: now, updatedAt: now, ...data };
    this.tables.decisionNotes.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findDecisionNoteById(id: string): Promise<DecisionNote | null> {
    return this.tables.decisionNotes.get(id) ?? null;
  }

  async listDecisionNotes(projectId: string, filter?: { targetType?: string; targetId?: string }): Promise<DecisionNote[]> {
    return sortDesc(
      [...this.tables.decisionNotes.values()].filter(
        (n) =>
          n.projectId === projectId &&
          (!filter?.targetType || n.targetType === filter.targetType) &&
          (!filter?.targetId || n.targetId === filter.targetId),
      ),
    );
  }

  async updateDecisionNote(id: string, patch: Partial<DecisionNote>): Promise<DecisionNote> {
    const existing = this.tables.decisionNotes.get(id);
    if (!existing) throw new Error(`Decision note not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.decisionNotes.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async appendAuditEvent(data: Omit<AuditEvent, "id" | "createdAt">): Promise<AuditEvent> {
    const row: AuditEvent = { id: newId("aud"), createdAt: nowIso(), ...data };
    this.tables.auditEvents.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listAuditEvents(
    filter: { organizationId?: string; projectId?: string; targetType?: string; targetId?: string } & ListQuery,
  ): Promise<PageResult<AuditEvent>> {
    const rows = [...this.tables.auditEvents.values()].filter(
      (e) =>
        (!filter.organizationId || e.organizationId === filter.organizationId) &&
        (!filter.projectId || e.projectId === filter.projectId) &&
        (!filter.targetType || e.targetType === filter.targetType) &&
        (!filter.targetId || e.targetId === filter.targetId),
    );
    return page(rows, filter);
  }

  async listDecisionsWithContext(projectId: string, query?: string): Promise<ApprovalDecision[]> {
    const approvalIds = new Set(
      [...this.tables.approvals.values()].filter((a) => a.projectId === projectId).map((a) => a.id),
    );
    let decisions = [...this.tables.decisions.values()].filter((d) => approvalIds.has(d.approvalRequestId));
    if (query) {
      const q = query.toLowerCase();
      decisions = decisions.filter(
        (d) =>
          (d.comment ?? "").toLowerCase().includes(q) ||
          (d.approverEmail ?? "").toLowerCase().includes(q),
      );
    }
    return sortDesc(decisions);
  }

  // ----- Notifications / outbox -----
  async createNotification(data: Omit<Notification, "id" | "createdAt" | "readAt">): Promise<Notification> {
    const row: Notification = { id: newId("ntf"), readAt: null, createdAt: nowIso(), ...data };
    this.tables.notifications.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listNotifications(userId: string, query: ListQuery): Promise<PageResult<Notification>> {
    return page(
      [...this.tables.notifications.values()].filter((n) => n.userId === userId),
      query,
    );
  }

  async markNotification(id: string, userId: string, readAt: string | null): Promise<Notification | null> {
    const existing = this.tables.notifications.get(id);
    if (!existing || existing.userId !== userId) return null;
    const updated = { ...existing, readAt };
    this.tables.notifications.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async enqueueOutbox(data: Pick<OutboxEvent, "type" | "payload" | "idempotencyKey">): Promise<OutboxEvent> {
    if (data.idempotencyKey) {
      for (const e of this.tables.outbox.values()) {
        if (e.idempotencyKey === data.idempotencyKey) return e;
      }
    }
    const now = nowIso();
    const row: OutboxEvent = {
      id: newId("obx"),
      status: "PENDING",
      attempts: 0,
      nextRunAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    this.tables.outbox.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async claimOutboxBatch(limit: number, nowIsoValue: string): Promise<OutboxEvent[]> {
    const due = [...this.tables.outbox.values()]
      .filter((e) => (e.status === "PENDING" || e.status === "FAILED") && e.nextRunAt <= nowIsoValue)
      .sort((a, b) => (a.nextRunAt < b.nextRunAt ? -1 : 1))
      .slice(0, limit);
    return due;
  }

  async updateOutbox(id: string, patch: Partial<OutboxEvent>): Promise<OutboxEvent> {
    const existing = this.tables.outbox.get(id);
    if (!existing) throw new Error(`Outbox event not found: ${id}`);
    const updated = { ...existing, ...patch, id, updatedAt: nowIso() };
    this.tables.outbox.set(id, updated);
    this.afterCommit();
    return updated;
  }

  // ----- AI / metrics / misc -----
  async createAIAnalysis(data: Omit<AIAnalysis, "id" | "createdAt">): Promise<AIAnalysis> {
    const row: AIAnalysis = { id: newId("aix"), createdAt: nowIso(), ...data };
    this.tables.aiAnalyses.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findAIAnalysisById(id: string): Promise<AIAnalysis | null> {
    return this.tables.aiAnalyses.get(id) ?? null;
  }

  async listAIAnalyses(projectId: string): Promise<AIAnalysis[]> {
    return sortDesc([...this.tables.aiAnalyses.values()].filter((a) => a.projectId === projectId));
  }

  async updateAIAnalysis(id: string, patch: Partial<AIAnalysis>): Promise<AIAnalysis> {
    const existing = this.tables.aiAnalyses.get(id);
    if (!existing) throw new Error(`AI analysis not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    this.tables.aiAnalyses.set(id, updated);
    this.afterCommit();
    return updated;
  }

  async recordMetric(data: Omit<MetricEvent, "id" | "createdAt">): Promise<MetricEvent> {
    const row: MetricEvent = { id: newId("met"), createdAt: nowIso(), ...data };
    this.tables.metricEvents.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async listMetrics(projectId: string, name?: string): Promise<MetricEvent[]> {
    return sortDesc(
      [...this.tables.metricEvents.values()].filter(
        (m) => m.projectId === projectId && (!name || m.name === name),
      ),
    );
  }

  async createExternalLink(data: Omit<ExternalLink, "id" | "createdAt">): Promise<ExternalLink> {
    for (const l of this.tables.externalLinks.values()) {
      if (l.changeRequestId === data.changeRequestId && l.provider === data.provider && l.externalId === data.externalId) {
        throw new Error("External link already exists");
      }
    }
    const row: ExternalLink = { id: newId("ext"), createdAt: nowIso(), ...data };
    this.tables.externalLinks.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async findExternalLinkById(id: string): Promise<ExternalLink | null> {
    return this.tables.externalLinks.get(id) ?? null;
  }

  async listExternalLinks(projectId: string): Promise<ExternalLink[]> {
    return sortDesc([...this.tables.externalLinks.values()].filter((l) => l.projectId === projectId));
  }

  async deleteExternalLink(id: string): Promise<void> {
    this.tables.externalLinks.delete(id);
    this.afterCommit();
  }

  async findIdempotency(key: string, scope: string): Promise<IdempotencyRecord | null> {
    for (const r of this.tables.idempotency.values()) {
      if (r.key === key && r.scope === scope) return r;
    }
    return null;
  }

  async saveIdempotency(data: Omit<IdempotencyRecord, "id" | "createdAt">): Promise<IdempotencyRecord> {
    const existing = await this.findIdempotency(data.key, data.scope);
    if (existing) return existing;
    const row: IdempotencyRecord = { id: newId("idem"), createdAt: nowIso(), ...data };
    this.tables.idempotency.set(row.id, row);
    this.afterCommit();
    return row;
  }

  async getUsage(organizationId: string, period: string): Promise<UsageCounter> {
    for (const u of this.tables.usage.values()) {
      if (u.organizationId === organizationId && u.period === period) return u;
    }
    const row: UsageCounter = {
      id: newId("use"),
      organizationId,
      period,
      aiCalls: 0,
      storageBytes: 0,
      emailsSent: 0,
      projectsCreated: 0,
    };
    this.tables.usage.set(row.id, row);
    return row;
  }

  async bumpUsage(
    organizationId: string,
    period: string,
    patch: Partial<Pick<UsageCounter, "aiCalls" | "storageBytes" | "emailsSent" | "projectsCreated">>,
  ): Promise<UsageCounter> {
    const row = await this.getUsage(organizationId, period);
    const updated: UsageCounter = {
      ...row,
      aiCalls: row.aiCalls + (patch.aiCalls ?? 0),
      storageBytes: row.storageBytes + (patch.storageBytes ?? 0),
      emailsSent: row.emailsSent + (patch.emailsSent ?? 0),
      projectsCreated: row.projectsCreated + (patch.projectsCreated ?? 0),
    };
    this.tables.usage.set(row.id, updated);
    this.afterCommit();
    return updated;
  }

  async listInboxApprovals(userId: string, userEmail: string): Promise<ApprovalRequest[]> {
    const email = userEmail.toLowerCase();
    const tokenApprovalIds = new Set(
      [...this.tables.approvalTokens.values()]
        .filter(
          (t) =>
            t.revokedAt === null &&
            (t.approverUserId === userId || (t.approverEmail && t.approverEmail.toLowerCase() === email)),
        )
        .map((t) => t.approvalRequestId),
    );
    return sortDesc(
      [...this.tables.approvals.values()].filter(
        (a) =>
          a.status === "SENT" &&
          (a.approverUserIds.includes(userId) || tokenApprovalIds.has(a.id)),
      ),
    );
  }

  async listExpiredPendingApprovals(nowIsoValue: string): Promise<ApprovalRequest[]> {
    return [...this.tables.approvals.values()].filter(
      (a) => a.status === "SENT" && a.expiresAt !== null && a.expiresAt <= nowIsoValue,
    );
  }

  async listApprovalsForReminders(nowIsoValue: string): Promise<ApprovalRequest[]> {
    return [...this.tables.approvals.values()].filter(
      (a) => a.status === "SENT" && a.expiresAt !== null && a.expiresAt > nowIsoValue,
    );
  }

  // ----- Snapshot helpers for file persistence -----
  dump(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const [key, map] of Object.entries(this.tables)) out[key] = [...(map as Map<string, unknown>).values()];
    return out;
  }

  load(data: Record<string, unknown[]>): void {
    const next = emptyTables();
    for (const [key, rows] of Object.entries(data)) {
      const table = (next as unknown as Record<string, Map<string, unknown>>)[key];
      if (!table || !Array.isArray(rows)) continue;
      for (const row of rows) {
        const rec = row as Record<string, unknown>;
        if (rec && typeof rec.id === "string") table.set(rec.id, row);
      }
    }
    this.tables = next;
  }

  currentPeriodValue(date = new Date()): string {
    return currentPeriod(date);
  }
}

import type {
  AIAnalysis,
  AllowanceDrawDown,
  AllowancePool,
  ApiKey,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalToken,
  Attachment,
  AuditChainHead,
  AuditEvent,
  Bundle,
  ChangeImpact,
  ChangeLink,
  ChangeOption,
  ChangeRequest,
  ChangeStatus,
  Clarification,
  Client,
  DecisionNote,
  DeliveryEvidence,
  EstimateTemplate,
  ExternalConnection,
  ExternalLink,
  ExternalWorkItem,
  IdempotencyRecord,
  InboundMailbox,
  IntakeLink,
  Invitation,
  ListQuery,
  Membership,
  MetricEvent,
  Notification,
  Organization,
  OutboxEvent,
  PageResult,
  PastDecision,
  PasswordReset,
  Project,
  ProjectMember,
  RateCard,
  Requirement,
  RequirementRevision,
  ScopeDocument,
  ScopeVersion,
  Session,
  StepUpChallenge,
  UsageCounter,
  User,
  WebhookDelivery,
  WebhookSubscription,
} from "./types.js";

/**
 * Storage contract. Two backends implement it:
 * - MemoryStore (+ JSON file persistence) for local development and tests.
 * - PrismaStore (PostgreSQL) for staging/production.
 */
export interface Store {
  transaction<T>(fn: (tx: Store) => Promise<T>): Promise<T>;

  // ----- Users / sessions -----
  createUser(data: Pick<User, "email" | "name" | "passwordHash">): Promise<User>;
  findUserById(id: string): Promise<User | null>;
  findUserByEmail(email: string): Promise<User | null>;
  updateUser(
    id: string,
    patch: Partial<Pick<User, "name" | "passwordHash" | "status" | "totpSecretEnc" | "mfaEnabled" | "mfaRecoveryHashes" | "phoneE164" | "notifyEmail" | "notifySms" | "notifyWhatsapp">>,
  ): Promise<User>;
  createSession(data: Pick<Session, "userId" | "tokenHash" | "expiresAt" | "ip">): Promise<Session>;
  findSessionByTokenHash(tokenHash: string): Promise<Session | null>;
  touchSession(id: string, lastSeenAt: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  deleteUserSessions(userId: string, exceptSessionId?: string): Promise<number>;
  createPasswordReset(data: Pick<PasswordReset, "userId" | "tokenHash" | "expiresAt">): Promise<PasswordReset>;
  findPasswordResetByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  markPasswordResetUsed(id: string, usedAt: string): Promise<void>;

  // ----- Organizations / memberships / invitations -----
  createOrganization(data: { name: string; plan?: Organization["plan"] }): Promise<Organization>;
  findOrganizationById(id: string): Promise<Organization | null>;
  listOrganizationsForUser(userId: string): Promise<Organization[]>;
  updateOrganization(id: string, patch: Partial<Organization>): Promise<Organization>;
  upsertMembership(organizationId: string, userId: string, role: Membership["role"]): Promise<Membership>;
  findMembership(organizationId: string, userId: string): Promise<Membership | null>;
  listMemberships(organizationId: string): Promise<Membership[]>;
  deleteMembership(organizationId: string, userId: string): Promise<void>;
  createInvitation(
    data: Pick<Invitation, "organizationId" | "email" | "role" | "projectId" | "projectRole" | "tokenHash" | "expiresAt" | "createdBy">,
  ): Promise<Invitation>;
  findInvitationByTokenHash(tokenHash: string): Promise<Invitation | null>;
  findInvitationById(id: string): Promise<Invitation | null>;
  listInvitations(organizationId: string): Promise<Invitation[]>;
  updateInvitation(id: string, patch: Partial<Invitation>): Promise<Invitation>;

  // ----- Clients / projects -----
  createClient(data: Pick<Client, "organizationId" | "name" | "company" | "contacts" | "notes">): Promise<Client>;
  findClientById(id: string): Promise<Client | null>;
  listClients(organizationId: string): Promise<Client[]>;
  updateClient(id: string, patch: Partial<Client>): Promise<Client>;
  createProject(
    data: Pick<Project, "organizationId" | "clientId" | "name" | "currency" | "budgetMinor" | "startDate" | "targetDate" | "settings">,
  ): Promise<Project>;
  findProjectById(id: string): Promise<Project | null>;
  listProjects(organizationId: string): Promise<Project[]>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  allocateChangeNumber(projectId: string): Promise<string>;
  allocateRequirementKey(projectId: string): Promise<string>;
  upsertProjectMember(projectId: string, userId: string, role: ProjectMember["role"]): Promise<ProjectMember>;
  findProjectMember(projectId: string, userId: string): Promise<ProjectMember | null>;
  listProjectMembers(projectId: string): Promise<ProjectMember[]>;
  listProjectIdsForUser(userId: string): Promise<string[]>;
  deleteProjectMember(projectId: string, userId: string): Promise<void>;

  // ----- Scope -----
  createScopeDocument(projectId: string, name: string): Promise<ScopeDocument>;
  findScopeDocumentById(id: string): Promise<ScopeDocument | null>;
  listScopeDocuments(projectId: string): Promise<ScopeDocument[]>;
  createScopeVersion(data: Omit<ScopeVersion, "id" | "sequence" | "createdAt" | "updatedAt">): Promise<ScopeVersion>;
  findScopeVersionById(id: string): Promise<ScopeVersion | null>;
  listScopeVersions(scopeDocumentId: string): Promise<ScopeVersion[]>;
  listProjectScopeVersions(projectId: string): Promise<ScopeVersion[]>;
  updateScopeVersion(id: string, patch: Partial<ScopeVersion>): Promise<ScopeVersion>;
  createRequirement(projectId: string, stableKey: string): Promise<Requirement>;
  findRequirementById(id: string): Promise<Requirement | null>;
  listRequirements(projectId: string): Promise<Requirement[]>;
  updateRequirement(id: string, patch: Partial<Requirement>): Promise<Requirement>;
  upsertRevision(data: Omit<RequirementRevision, "id" | "createdAt">): Promise<RequirementRevision>;
  listRevisionsByVersion(scopeVersionId: string): Promise<RequirementRevision[]>;
  deleteRevision(requirementId: string, scopeVersionId: string): Promise<void>;

  // ----- Changes -----
  createChange(data: Omit<ChangeRequest, "id" | "number" | "version" | "createdAt" | "updatedAt" | "decidedAt" | "implementedAt">): Promise<ChangeRequest>;
  findChangeById(id: string): Promise<ChangeRequest | null>;
  listChanges(projectId: string, filter?: { status?: ChangeStatus[]; bundleId?: string | null }): Promise<ChangeRequest[]>;
  updateChange(id: string, patch: Partial<ChangeRequest>): Promise<ChangeRequest>;
  findLatestImpact(changeRequestId: string): Promise<ChangeImpact | null>;
  listImpacts(changeRequestId: string): Promise<ChangeImpact[]>;
  createImpact(data: Omit<ChangeImpact, "id" | "version" | "createdAt" | "updatedAt">): Promise<ChangeImpact>;
  /** Patch actuals onto the latest impact; throws when the change has no impact yet. */
  recordActuals(
    changeRequestId: string,
    patch: Pick<ChangeImpact, "actualEffortDays" | "actualPriceMinor" | "actualNotes">,
  ): Promise<ChangeImpact>;
  findOptionById(id: string): Promise<ChangeOption | null>;
  listOptionsByChange(changeRequestId: string): Promise<ChangeOption[]>;
  createOption(data: Omit<ChangeOption, "id" | "version" | "createdAt" | "updatedAt">): Promise<ChangeOption>;
  updateOption(id: string, patch: Partial<ChangeOption>): Promise<ChangeOption>;
  deleteOption(id: string): Promise<void>;
  createChangeLink(data: Omit<ChangeLink, "id" | "createdAt">): Promise<ChangeLink>;
  listChangeLinks(changeRequestId: string): Promise<ChangeLink[]>;
  deleteChangeLink(id: string): Promise<void>;
  createClarification(data: Omit<Clarification, "id" | "createdAt" | "answeredAt" | "answeredBy" | "answer">): Promise<Clarification>;
  listClarifications(changeRequestId: string): Promise<Clarification[]>;
  answerClarification(id: string, answer: string, answeredBy: string, answeredAt: string): Promise<Clarification>;

  // ----- Rate cards / estimate templates -----
  createRateCard(data: {
    organizationId: string;
    name: string;
    currency: string;
    isDefault: boolean;
    createdBy: string;
    rates: Array<{ role: string; hourlyRateMinor: number }>;
  }): Promise<RateCard>;
  findRateCardById(id: string): Promise<RateCard | null>;
  listRateCards(organizationId: string): Promise<RateCard[]>;
  updateRateCard(
    id: string,
    patch: Partial<Pick<RateCard, "name" | "currency" | "isDefault">> & { rates?: Array<{ role: string; hourlyRateMinor: number }> },
  ): Promise<RateCard>;
  deleteRateCard(id: string): Promise<void>;
  createEstimateTemplate(data: {
    organizationId: string;
    name: string;
    items: EstimateTemplate["items"];
    contingencyPct: number;
    taxPct: number | null;
    createdBy: string;
  }): Promise<EstimateTemplate>;
  findEstimateTemplateById(id: string): Promise<EstimateTemplate | null>;
  listEstimateTemplates(organizationId: string): Promise<EstimateTemplate[]>;
  updateEstimateTemplate(id: string, patch: Partial<Pick<EstimateTemplate, "name" | "items" | "contingencyPct" | "taxPct">>): Promise<EstimateTemplate>;
  deleteEstimateTemplate(id: string): Promise<void>;
  /** Impacts referencing a card (delete/rate-change guards). */
  countImpactsByRateCard(rateCardId: string): Promise<number>;

  // ----- Allowance pools -----
  createAllowancePool(data: {
    projectId: string;
    name: string;
    kind: AllowancePool["kind"];
    totalHours: number | null;
    totalMinor: number | null;
    currency: string | null;
    objectionWindowHours: number;
    enabled: boolean;
    createdBy: string;
  }): Promise<AllowancePool>;
  findAllowancePoolById(id: string): Promise<AllowancePool | null>;
  listAllowancePools(projectId: string): Promise<AllowancePool[]>;
  updateAllowancePool(id: string, patch: Partial<AllowancePool>): Promise<AllowancePool>;
  /** Touch updatedAt (decision-time row lock against concurrent draw-downs). */
  touchAllowancePool(id: string): Promise<AllowancePool>;
  createDrawDown(data: {
    poolId: string;
    changeRequestId: string;
    hours: number | null;
    amountMinor: number | null;
    notifiedAt: string;
    objectionDeadline: string;
  }): Promise<AllowanceDrawDown>;
  findDrawDownById(id: string): Promise<AllowanceDrawDown | null>;
  findDrawDownByChange(changeRequestId: string): Promise<AllowanceDrawDown | null>;
  listDrawDownsByPool(poolId: string): Promise<AllowanceDrawDown[]>;
  updateDrawDown(id: string, patch: Partial<AllowanceDrawDown>): Promise<AllowanceDrawDown>;
  listApprovalsForPool(allowancePoolId: string): Promise<ApprovalRequest[]>;

  // ----- Bundles -----
  createBundle(data: Pick<Bundle, "projectId" | "name" | "adjustmentMinor" | "adjustmentNote" | "createdBy">): Promise<Bundle>;
  findBundleById(id: string): Promise<Bundle | null>;
  listBundles(projectId: string): Promise<Bundle[]>;
  updateBundle(id: string, patch: Partial<Bundle>): Promise<Bundle>;

  // ----- Approvals -----
  createApproval(data: Omit<ApprovalRequest, "id" | "createdAt" | "updatedAt">): Promise<ApprovalRequest>;
  findApprovalById(id: string): Promise<ApprovalRequest | null>;
  listApprovalsForChange(changeRequestId: string): Promise<ApprovalRequest[]>;
  listApprovalsForBundle(bundleId: string): Promise<ApprovalRequest[]>;
  listAcceptanceApprovalsForRequirement(requirementId: string): Promise<ApprovalRequest[]>;
  listUnescalatedSentApprovals(): Promise<ApprovalRequest[]>;
  listProjectApprovals(projectId: string): Promise<ApprovalRequest[]>;
  updateApproval(id: string, patch: Partial<ApprovalRequest>): Promise<ApprovalRequest>;
  createApprovalToken(data: Omit<ApprovalToken, "id" | "createdAt" | "lastUsedAt" | "revokedAt">): Promise<ApprovalToken>;
  findApprovalTokenByHash(tokenHash: string): Promise<ApprovalToken | null>;
  listApprovalTokens(approvalRequestId: string): Promise<ApprovalToken[]>;
  updateApprovalToken(id: string, patch: Partial<ApprovalToken>): Promise<ApprovalToken>;
  createStepUpChallenge(data: Omit<StepUpChallenge, "id" | "attempts" | "consumedAt" | "createdAt">): Promise<StepUpChallenge>;
  listStepUpChallenges(approvalRequestId: string): Promise<StepUpChallenge[]>;
  updateStepUpChallenge(id: string, patch: Partial<StepUpChallenge>): Promise<StepUpChallenge>;
  createDecision(data: Omit<ApprovalDecision, "id" | "createdAt">): Promise<ApprovalDecision>;
  listDecisions(approvalRequestId: string): Promise<ApprovalDecision[]>;

  // ----- Inbound mailboxes -----
  createInboundMailbox(data: Omit<InboundMailbox, "id" | "createdAt">): Promise<InboundMailbox>;
  findInboundMailboxByLocalPart(localPart: string): Promise<InboundMailbox | null>;
  findInboundMailboxById(id: string): Promise<InboundMailbox | null>;
  listInboundMailboxes(projectId: string): Promise<InboundMailbox[]>;
  deleteInboundMailbox(id: string): Promise<void>;

  // ----- Intake links -----
  createIntakeLink(data: Omit<IntakeLink, "id" | "createdAt" | "lastUsedAt" | "revokedAt" | "submissions">): Promise<IntakeLink>;
  findIntakeLinkByHash(tokenHash: string): Promise<IntakeLink | null>;
  findIntakeLinkById(id: string): Promise<IntakeLink | null>;
  listIntakeLinks(projectId: string): Promise<IntakeLink[]>;
  updateIntakeLink(id: string, patch: Partial<IntakeLink>): Promise<IntakeLink>;

  // ----- Files / evidence -----
  createAttachment(data: Omit<Attachment, "id" | "createdAt" | "completedAt">): Promise<Attachment>;
  findAttachmentById(id: string): Promise<Attachment | null>;
  listAttachments(projectId: string): Promise<Attachment[]>;
  /** Retention GC candidates across all projects (ISO cutoffs). */
  listAttachmentsForGc(pendingBefore: string, deletedBefore: string): Promise<Attachment[]>;
  updateAttachment(id: string, patch: Partial<Attachment>): Promise<Attachment>;
  createEvidence(data: Omit<DeliveryEvidence, "id" | "createdAt" | "verifiedAt" | "verifierId">): Promise<DeliveryEvidence>;
  findEvidenceById(id: string): Promise<DeliveryEvidence | null>;
  listEvidenceForRequirement(requirementId: string): Promise<DeliveryEvidence[]>;
  updateEvidence(id: string, patch: Partial<DeliveryEvidence>): Promise<DeliveryEvidence>;

  // ----- Notes / audit / activity -----
  createDecisionNote(data: Pick<DecisionNote, "projectId" | "targetType" | "targetId" | "body" | "authorId">): Promise<DecisionNote>;
  findDecisionNoteById(id: string): Promise<DecisionNote | null>;
  listDecisionNotes(projectId: string, filter?: { targetType?: string; targetId?: string }): Promise<DecisionNote[]>;
  updateDecisionNote(id: string, patch: Partial<DecisionNote>): Promise<DecisionNote>;
  appendAuditEvent(data: Omit<AuditEvent, "id" | "createdAt" | "prevHash" | "hash" | "chainSeq">): Promise<AuditEvent>;
  listAuditEvents(filter: { organizationId?: string; projectId?: string; targetType?: string; targetId?: string } & ListQuery): Promise<PageResult<AuditEvent>>;
  getAuditChainHead(chainKey: string): Promise<AuditChainHead | null>;
  listAuditChain(chainKey: string): Promise<AuditEvent[]>;
  listDecisionsWithContext(projectId: string, query?: string): Promise<ApprovalDecision[]>;

  // ----- Notifications / outbox -----
  createNotification(data: Omit<Notification, "id" | "createdAt" | "readAt">): Promise<Notification>;
  listNotifications(userId: string, query: ListQuery): Promise<PageResult<Notification>>;
  markNotification(id: string, userId: string, readAt: string | null): Promise<Notification | null>;
  enqueueOutbox(data: Pick<OutboxEvent, "type" | "payload" | "idempotencyKey">): Promise<OutboxEvent>;
  claimOutboxBatch(limit: number, nowIso: string): Promise<OutboxEvent[]>;
  updateOutbox(id: string, patch: Partial<OutboxEvent>): Promise<OutboxEvent>;

  // ----- API keys / webhooks -----
  createApiKey(data: Omit<ApiKey, "id" | "createdAt">): Promise<ApiKey>;
  findApiKeyById(id: string): Promise<ApiKey | null>;
  findApiKeyByHash(keyHash: string): Promise<ApiKey | null>;
  listApiKeys(organizationId: string): Promise<ApiKey[]>;
  updateApiKey(id: string, patch: Partial<ApiKey>): Promise<ApiKey>;
  createWebhook(data: Omit<WebhookSubscription, "id" | "createdAt" | "updatedAt">): Promise<WebhookSubscription>;
  findWebhookById(id: string): Promise<WebhookSubscription | null>;
  listWebhooks(organizationId: string): Promise<WebhookSubscription[]>;
  updateWebhook(id: string, patch: Partial<WebhookSubscription>): Promise<WebhookSubscription>;
  deleteWebhook(id: string): Promise<void>;
  createWebhookDelivery(data: Omit<WebhookDelivery, "id" | "createdAt" | "updatedAt">): Promise<WebhookDelivery>;
  findWebhookDeliveryById(id: string): Promise<WebhookDelivery | null>;
  findWebhookDeliveryByOutboxId(outboxEventId: string): Promise<WebhookDelivery | null>;
  listWebhookDeliveries(subscriptionId: string, query: ListQuery): Promise<PageResult<WebhookDelivery>>;
  updateWebhookDelivery(id: string, patch: Partial<WebhookDelivery>): Promise<WebhookDelivery>;

  // ----- AI / metrics / misc -----
  createAIAnalysis(data: Omit<AIAnalysis, "id" | "createdAt">): Promise<AIAnalysis>;
  findAIAnalysisById(id: string): Promise<AIAnalysis | null>;
  listAIAnalyses(projectId: string): Promise<AIAnalysis[]>;
  updateAIAnalysis(id: string, patch: Partial<AIAnalysis>): Promise<AIAnalysis>;
  recordMetric(data: Omit<MetricEvent, "id" | "createdAt">): Promise<MetricEvent>;
  listMetrics(projectId: string, name?: string): Promise<MetricEvent[]>;
  createExternalLink(data: Omit<ExternalLink, "id" | "createdAt">): Promise<ExternalLink>;
  findExternalLinkById(id: string): Promise<ExternalLink | null>;
  listExternalLinks(projectId: string): Promise<ExternalLink[]>;
  deleteExternalLink(id: string): Promise<void>;
  createExternalConnection(data: Omit<ExternalConnection, "id" | "createdAt" | "updatedAt">): Promise<ExternalConnection>;
  findExternalConnectionById(id: string): Promise<ExternalConnection | null>;
  listExternalConnections(projectId: string): Promise<ExternalConnection[]>;
  updateExternalConnection(id: string, patch: Partial<ExternalConnection>): Promise<ExternalConnection>;
  deleteExternalConnection(id: string): Promise<void>;
  upsertExternalWorkItem(data: Omit<ExternalWorkItem, "id" | "observedAt" | "updatedAt">): Promise<ExternalWorkItem>;
  listExternalWorkItems(projectId: string): Promise<ExternalWorkItem[]>;
  findPastDecision(approvalId: string): Promise<PastDecision | null>;
  searchPastDecisionsLexical(projectIds: string[], query: string, limit: number): Promise<PastDecision[]>;
  searchPastDecisionsSemantic(projectIds: string[], embedding: number[], limit: number): Promise<PastDecision[]>;
  saveDecisionEmbedding(approvalId: string, embedding: number[], model: string): Promise<void>;
  listApprovalsWithoutEmbeddings(limit: number): Promise<string[]>;
  findIdempotency(key: string, scope: string): Promise<IdempotencyRecord | null>;
  saveIdempotency(data: Omit<IdempotencyRecord, "id" | "createdAt">): Promise<IdempotencyRecord>;
  getUsage(organizationId: string, period: string): Promise<UsageCounter>;
  bumpUsage(organizationId: string, period: string, patch: Partial<Pick<UsageCounter, "aiCalls" | "storageBytes" | "emailsSent" | "projectsCreated">>): Promise<UsageCounter>;

  /** Locate the approval overview for the inbox: SENT approvals assigned to a user. */
  listInboxApprovals(userId: string, userEmail: string): Promise<ApprovalRequest[]>;

  /** SENT approvals whose expiry passed (for the outbox/expiry worker). */
  listExpiredPendingApprovals(nowIso: string): Promise<ApprovalRequest[]>;

  /** SENT approvals needing reminders (worker). */
  listApprovalsForReminders(nowIso: string): Promise<ApprovalRequest[]>;
}

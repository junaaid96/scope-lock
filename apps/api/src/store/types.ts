import type {
  AIKind,
  AIStatus,
  ApprovalDecision as ApprovalDecisionValue,
  ApprovalStatus,
  AttachmentStatus,
  BundleStatus,
  ChangeClassification,
  ChangeStatus,
  ConfidenceLevel,
  EvidenceStatus,
  EvidenceType,
  LinkCondition,
  LinkKind,
  OrgRole,
  Plan,
  ProjectRole,
  ProjectStatus,
  RequirementStatus,
  ScopeVersionStatus,
} from "@scopelock/domain";

export type {
  AIKind,
  AIStatus,
  ApprovalStatus,
  AttachmentStatus,
  BundleStatus,
  ChangeClassification,
  ChangeStatus,
  ConfidenceLevel,
  EvidenceStatus,
  EvidenceType,
  LinkCondition,
  LinkKind,
  OrgRole,
  Plan,
  ProjectRole,
  ProjectStatus,
  RequirementStatus,
  ScopeVersionStatus,
};
export type { ApprovalDecisionValue };

// ---------- Entities (timestamps are ISO strings at this boundary) ----------

export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string | null;
  status: "ACTIVE" | "DISABLED";
  /** AES-GCM sealed TOTP secret (see lib/mfa). Null until MFA setup. */
  totpSecretEnc: string | null;
  mfaEnabled: boolean;
  /** SHA-256 hashes of single-use recovery codes. */
  mfaRecoveryHashes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OrgBranding {
  displayName: string;
  logoUrl?: string;
  primaryColor?: string;
}

export interface Organization {
  id: string;
  name: string;
  plan: Plan;
  aiEnabled: boolean;
  branding: OrgBranding | null;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: string;
  updatedAt: string;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  role: OrgRole;
  projectId: string | null;
  projectRole: ProjectRole | null;
  tokenHash: string;
  status: InvitationStatus;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
}

export interface Session {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
  ip: string | null;
}

export interface PasswordReset {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface ClientContact {
  name?: string;
  email?: string;
}

export interface Client {
  id: string;
  organizationId: string;
  name: string;
  company: string | null;
  contacts: ClientContact[];
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  aiEnabled: boolean;
  reminderHoursBeforeExpiry: number[];
}

export interface Project {
  id: string;
  organizationId: string;
  clientId: string;
  name: string;
  currency: string;
  status: ProjectStatus;
  budgetMinor: number | null;
  startDate: string | null;
  targetDate: string | null;
  settings: ProjectSettings;
  externalIntegrationsEnabled: boolean;
  changeCounter: number;
  requirementCounter: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
}

export interface ScopeDocument {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeVersion {
  id: string;
  scopeDocumentId: string;
  projectId: string;
  sequence: number;
  status: ScopeVersionStatus;
  title: string | null;
  summary: string | null;
  assumptions: string[];
  exclusions: string[];
  version: number;
  publishedAt: string | null;
  publishedBy: string | null;
  createdBy: string;
  supersedesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Requirement {
  id: string;
  projectId: string;
  stableKey: string;
  status: RequirementStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementRevision {
  id: string;
  requirementId: string;
  scopeVersionId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category: string | null;
  priority: string | null;
  order: number;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  projectId: string;
  number: string;
  title: string;
  description: string;
  source: string;
  status: ChangeStatus;
  classification: ChangeClassification | null;
  classificationRationale: string | null;
  submitterId: string;
  bundleId: string | null;
  version: number;
  decidedAt: string | null;
  implementedAt: string | null;
  amendmentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeImpact {
  id: string;
  changeRequestId: string;
  effortDays: number | null;
  priceMinor: number | null;
  currency: string | null;
  timelineDays: number | null;
  milestoneEffect: string | null;
  risks: string[];
  exclusions: string[];
  notes: string | null;
  confidence: ConfidenceLevel;
  version: number;
  rateCardId: string | null;
  templateId: string | null;
  pricing: ImpactPricing | null;
  overrideReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Frozen computation snapshot: what the card/template math produced when the impact was recorded. */
export interface ImpactPricingLine {
  label: string;
  role: string;
  hours: number;
  hourlyRateMinor: number;
  lineMinor: number;
}

export interface ImpactPricing {
  mode: "COMPUTED" | "OVERRIDE";
  rateCardId: string;
  rateCardName: string;
  templateId: string | null;
  templateName: string | null;
  currency: string;
  lines: ImpactPricingLine[];
  subtotalMinor: number;
  contingencyPct: number;
  contingencyMinor: number;
  taxPct: number | null;
  taxMinor: number;
  computedMinor: number;
}

export interface RateCardEntry {
  id: string;
  rateCardId: string;
  role: string;
  hourlyRateMinor: number;
}

export interface RateCard {
  id: string;
  organizationId: string;
  name: string;
  currency: string;
  isDefault: boolean;
  rates: RateCardEntry[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface EstimateTemplateItem {
  label: string;
  role: string;
  hours: number;
}

export interface EstimateTemplate {
  id: string;
  organizationId: string;
  name: string;
  items: EstimateTemplateItem[];
  contingencyPct: number;
  taxPct: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChangeLink {
  id: string;
  changeRequestId: string;
  targetType: "REQUIREMENT" | "CHANGE";
  targetRequirementId: string | null;
  targetChangeId: string | null;
  scopeVersionId: string | null;
  kind: LinkKind;
  condition: LinkCondition | null;
  overrideRationale: string | null;
  overrideBy: string | null;
  createdBy: string;
  createdAt: string;
}

export interface Clarification {
  id: string;
  changeRequestId: string;
  question: string;
  answer: string | null;
  askedBy: string;
  answeredBy: string | null;
  askedAt: string;
  answeredAt: string | null;
  createdAt: string;
}

export interface Bundle {
  id: string;
  projectId: string;
  name: string;
  status: BundleStatus;
  adjustmentMinor: number;
  adjustmentNote: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** Immutable snapshot of exactly what the client reviewed. Bound to decisions via checksum. */
export interface ReviewPackageSnapshot {
  title: string | null;
  changeId: string | null;
  bundleId: string | null;
  request: {
    number: string;
    title: string;
    description: string;
    source: string;
    classification: ChangeClassification | null;
  } | null;
  members: Array<{ changeId: string; number: string; title: string; description: string }>;
  impact: {
    effortDays: number | null;
    priceMinor: number | null;
    currency: string | null;
    timelineDays: number | null;
    milestoneEffect: string | null;
    risks: string[];
    exclusions: string[];
    notes: string | null;
    confidence: ConfidenceLevel;
  } | null;
  requirements: Array<{
    requirementId: string;
    stableKey: string;
    title: string;
    description: string;
    acceptanceCriteria: string[];
    scopeVersionId: string;
    versionSequence: number;
  }>;
  attachments: Array<{
    attachmentId: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
  }>;
  assumptions: string[];
  exclusions: string[];
  sentAt: string;
}

export interface ApprovalRequest {
  id: string;
  projectId: string;
  changeRequestId: string | null;
  bundleId: string | null;
  title: string | null;
  package: ReviewPackageSnapshot;
  checksum: string;
  status: ApprovalStatus;
  approverUserIds: string[];
  expiresAt: string | null;
  sentAt: string | null;
  sentBy: string | null;
  createdBy: string;
  invalidatedReason: string | null;
  supersededBy: string | null;
  remindersSent: number[];
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalToken {
  id: string;
  approvalRequestId: string;
  tokenHash: string;
  approverEmail: string | null;
  approverUserId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApprovalDecision {
  id: string;
  approvalRequestId: string;
  approverUserId: string | null;
  approverEmail: string | null;
  tokenId: string | null;
  decision: ApprovalDecisionValue;
  comment: string | null;
  checksum: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface Attachment {
  id: string;
  projectId: string;
  ownerId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  storageKey: string;
  status: AttachmentStatus;
  linkedType: string | null;
  linkedId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface DeliveryEvidence {
  id: string;
  requirementId: string;
  projectId: string;
  type: EvidenceType;
  title: string;
  url: string | null;
  attachmentId: string | null;
  note: string | null;
  status: EvidenceStatus;
  authorId: string;
  verifierId: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface DecisionNoteEdit {
  body: string;
  editedBy: string;
  editedAt: string;
}

export interface DecisionNote {
  id: string;
  projectId: string;
  targetType: string;
  targetId: string;
  body: string;
  authorId: string;
  editHistory: DecisionNoteEdit[];
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  correlationId: string;
  ip: string | null;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  projectId: string | null;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export type OutboxType = "EMAIL" | "REALTIME";
export type OutboxStatus = "PENDING" | "SENT" | "FAILED" | "DEAD";

export interface OutboxEvent {
  id: string;
  type: OutboxType;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  nextRunAt: string;
  lastError: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIAnalysis {
  id: string;
  projectId: string;
  changeRequestId: string | null;
  kind: AIKind;
  inputRefs: Record<string, unknown>;
  model: string;
  promptVersion: string;
  output: unknown;
  status: AIStatus;
  usage: AiUsage | null;
  latencyMs: number | null;
  error: string | null;
  reviewerDisposition: string | null;
  reviewedBy: string | null;
  createdBy: string;
  createdAt: string;
}

export interface ExternalLink {
  id: string;
  projectId: string;
  changeRequestId: string;
  provider: string;
  externalId: string;
  url: string | null;
  createdBy: string;
  createdAt: string;
}

export interface MetricEvent {
  id: string;
  organizationId: string;
  projectId: string;
  name: string;
  properties?: unknown;
  actorId: string | null;
  createdAt: string;
}

export interface IdempotencyRecord {
  id: string;
  key: string;
  scope: string;
  statusCode: number;
  body: unknown;
  createdAt: string;
  expiresAt: string;
}

export interface UsageCounter {
  id: string;
  organizationId: string;
  period: string;
  aiCalls: number;
  storageBytes: number;
  emailsSent: number;
  projectsCreated: number;
}

// ---------- Query helpers ----------

export interface ListQuery {
  cursor?: string;
  limit?: number;
}

export interface PageResult<T> {
  items: T[];
  nextCursor: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function currentPeriod(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

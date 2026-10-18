// Client-side mirrors of API entities (subset of fields used by the UI).

export interface Client {
  id: string;
  name: string;
  company: string | null;
  contacts?: Array<{ name?: string; email?: string; role?: string }>;
  notes?: string | null;
}

export interface ProjectListItem {
  id: string;
  organizationId: string;
  clientId: string;
  name: string;
  currency: string;
  status: string;
  myRole: string | null;
  openChanges: number;
  pendingApprovals: number;
  myInbox: number;
  createdAt: string;
}

export interface ProjectDetail extends ProjectListItem {
  budgetMinor: number | null;
  startDate: string | null;
  targetDate: string | null;
  settings: {
    aiEnabled: boolean;
    reminderHoursBeforeExpiry: number[];
    approvalPolicies?: Array<{ uptoMinor: number | null; mode: "ANY" | "ALL" | "SEQUENTIAL" }>;
    stepUp?: { otp: boolean | null; typedName: boolean | null };
    deemedAcceptanceDays?: number | null;
    escalation?: { afterHours: number | null; target: "SECOND_APPROVER" | "AGENCY_LEAD" };
    defaultLocale?: string | null;
  };
  externalIntegrationsEnabled: boolean;
  client: Client | null;
  counts: { openChanges: number; pendingApprovals: number; publishedSequence: number | null };
}

export interface ScopeVersion {
  id: string;
  scopeDocumentId: string;
  projectId: string;
  sequence: number;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  title: string | null;
  summary: string | null;
  assumptions: string[];
  exclusions: string[];
  version: number;
  publishedAt: string | null;
  documentName?: string | null;
  revisions?: Revision[];
}

export interface Revision {
  id: string;
  requirementId: string;
  scopeVersionId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category: string | null;
  priority: string | null;
  order: number;
  stableKey?: string | null;
  status?: string | null;
}

export interface RequirementRow {
  id: string;
  stableKey: string;
  status: string;
  published: Revision | null;
  draft: Revision | null;
}

export interface ChangeListItem {
  id: string;
  number: string;
  title: string;
  status: string;
  classification: string | null;
  version: number;
  createdAt: string;
  impact: Impact | null;
  linkCount: number;
}

export interface Impact {
  effortDays: number | null;
  priceMinor: number | null;
  currency: string | null;
  timelineDays: number | null;
  milestoneEffect: string | null;
  risks: string[];
  exclusions: string[];
  notes: string | null;
  confidence: string;
  rateCardId: string | null;
  templateId: string | null;
  pricing: ImpactPricing | null;
  overrideReason: string | null;
  actualEffortDays: number | null;
  actualPriceMinor: number | null;
  actualNotes: string | null;
}

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

export interface ChangeDetail extends ChangeListItem {
  projectId: string;
  description: string;
  source: string;
  classificationRationale: string | null;
  submitterId: string | null;
  submitterName: string | null;
  submitterEmail: string | null;
  unverifiedSubmitter: boolean;
  bundleId: string | null;
  decidedAt: string | null;
  impacts: Impact[];
  options?: ChangeOptionView[];
  links: Array<{
    id: string;
    targetType: string;
    targetRequirementId: string | null;
    targetChangeId: string | null;
    kind: string;
    condition: string | null;
    overrideRationale: string | null;
    targetTitle: string | null;
    targetStatus?: string | null;
  }>;
  clarifications: Array<{ id: string; question: string; answer: string | null; askedAt: string; answeredAt: string | null }>;
  approvals: Approval[];
  decisions: Decision[];
  bundle: { id: string; name: string } | null;
  governingVersion: { id: string; sequence: number } | null;
  sendBlockers: string[];
  drawAllowancePoolId: string | null;
  drawPool: { id: string; name: string; kind: string; status: string; enabled: boolean } | null;
  drawDown: { id: string; hours: number | null; amountMinor: number | null; status: string; objectionDeadline: string | null } | null;
  externalLinks: Array<{ id: string; provider: string; externalId: string; url: string | null }>;
  attachments: AttachmentRow[];
}

export interface AttachmentRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: string;
  linkedType: string | null;
  linkedId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface EvidenceRow {
  id: string;
  requirementId: string;
  type: string;
  title: string;
  url: string | null;
  attachmentId: string | null;
  note: string | null;
  status: string;
  createdAt: string;
}

export interface AiAnalysisRow {
  id: string;
  kind: string;
  model: string;
  promptVersion: string;
  output: unknown;
  status: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
  latencyMs: number | null;
  error: string | null;
  reviewerDisposition: string | null;
  createdAt: string;
}

export interface Approval {
  id: string;
  title: string | null;
  status: string;
  checksum: string;
  expiresAt: string | null;
  sentAt: string | null;
  invalidatedReason: string | null;
  chosenOptionId?: string | null;
  package?: ReviewPackage;
  createdAt: string;
}

export interface Decision {
  id: string;
  decision: string;
  comment: string | null;
  approverEmail: string | null;
  optionId?: string | null;
  optionLabel?: string | null;
  typedName?: string | null;
  checksum: string;
  createdAt: string;
}

export interface OptionSnapshotView {
  optionId: string;
  label: string;
  description: string | null;
  effortDays: number | null;
  priceMinor: number | null;
  currency: string | null;
  timelineDays: number | null;
  milestoneEffect: string | null;
  risks: string[];
  exclusions: string[];
  notes: string | null;
}

export interface ChangeOptionView extends OptionSnapshotView {
  id: string;
  changeRequestId: string;
  version: number;
  createdAt: string;
}

export interface ReviewPackage {
  title: string | null;
  changeId: string | null;
  bundleId: string | null;
  request: { number: string; title: string; description: string; source: string; classification: string | null } | null;
  members: Array<{ changeId: string; number: string; title: string; description: string }>;
  impact: Impact | null;
  options?: OptionSnapshotView[];
  requirements: Array<{ requirementId: string; stableKey: string; title: string; description: string; acceptanceCriteria: string[]; versionSequence: number }>;
  attachments: Array<{ fileName: string; contentType: string; sizeBytes: number }>;
  assumptions: string[];
  exclusions: string[];
  sentAt: string;
  allowance?: {
    poolId: string;
    kind: "HOURS" | "AMOUNT";
    totalHours: number | null;
    totalMinor: number | null;
    currency: string | null;
    objectionWindowHours: number;
  } | null;
  acceptance?: {
    requirements: Array<{
      requirementId: string;
      stableKey: string;
      title: string;
      description: string;
      acceptanceCriteria: string[];
      evidence: Array<{ evidenceId: string; type: string; title: string; url: string | null; status: string }>;
    }>;
  } | null;
}

export interface AllowanceDrawDownView {
  id: string;
  poolId: string;
  changeRequestId: string;
  hours: number | null;
  amountMinor: number | null;
  status: string;
  notifiedAt: string;
  objectionDeadline: string | null;
  objectionReason: string | null;
  resolutionNote: string | null;
  createdAt: string;
  changeNumber: string;
  changeTitle: string;
}

export interface AllowancePoolView {
  id: string;
  projectId: string;
  name: string;
  kind: "HOURS" | "AMOUNT";
  totalHours: number | null;
  totalMinor: number | null;
  currency: string | null;
  objectionWindowHours: number;
  enabled: boolean;
  status: string;
  grantDecisionId: string | null;
  createdAt: string;
  balance: { kind: "HOURS" | "AMOUNT"; remainingHours: number | null; remainingMinor: number | null; exhausted: boolean };
  drawDowns: AllowanceDrawDownView[];
}

export interface HealthSignal {
  key: string;
  label: string;
  count: number;
  detail: string;
  itemIds: string[];
}

export interface ScopeHealth {
  score: number;
  summary: string;
  signals: HealthSignal[];
}

export interface ActivityEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorEmail: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

export interface AuditVerifyResult {
  chainKey: string;
  events: number;
  chained: number;
  legacy: number;
  valid: boolean;
  breakAtSeq: number | null;
  reason: string | null;
  headHash: string | null;
  headSeq: number | null;
  verifiedAt: string;
}

export interface LedgerDelta {
  changeId: string;
  number: string;
  title: string;
  priceMinor: number;
  decidedAt: string;
  amendmentVersionId: string | null;
}

export interface LedgerPending {
  changeId: string;
  number: string;
  title: string;
  priceMinor: number;
  status: string;
}

export interface LedgerAbsorbed {
  changeId: string;
  number: string;
  title: string;
  effortDays: number | null;
  decidedAt: string;
}

export interface LedgerExclusion {
  changeId: string;
  number: string;
  reason: string;
  detail: string;
}

export interface VersionValue {
  scopeVersionId: string;
  sequence: number;
  status: string;
  title: string | null;
  deltaMinor: number;
  changeNumbers: string[];
}

export interface ContractLedger {
  currency: string;
  baselineMinor: number | null;
  approvedDeltaMinor: number;
  currentMinor: number | null;
  pendingExposureMinor: number;
  unattributedMinor: number;
  unattributedNumbers: string[];
  absorbedEffortDays: number;
  absorbedCount: number;
  deltas: LedgerDelta[];
  pending: LedgerPending[];
  absorbed: LedgerAbsorbed[];
  excluded: LedgerExclusion[];
  byVersion: VersionValue[];
}

export interface OrgProjectSummary {
  projectId: string;
  name: string;
  currency: string;
  baselineMinor: number | null;
  currentMinor: number | null;
  pendingExposureMinor: number;
  absorbedCount: number;
}

export interface OrgContractRollup {
  projects: OrgProjectSummary[];
  totalsByCurrency: Array<{
    currency: string;
    projectCount: number;
    baselineMinor: number;
    currentMinor: number;
    pendingExposureMinor: number;
  }>;
}

export interface ApiKeyView {
  id: string;
  organizationId: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface WebhookView {
  id: string;
  organizationId: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryView {
  id: string;
  subscriptionId: string;
  event: string;
  status: "PENDING" | "SENT" | "FAILED" | "DEAD";
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalConnectionView {
  id: string;
  projectId: string;
  provider: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalWorkItemView {
  id: string;
  projectId: string;
  provider: string;
  externalId: string;
  kind: "PULL_REQUEST" | "PUSH";
  url: string | null;
  title: string | null;
  refs: string[];
  merged: boolean;
  mergedAt: string | null;
  observedAt: string;
  updatedAt: string;
}

export interface NotificationPreferences {
  userId: string;
  phoneE164: string | null;
  notifyEmail: boolean;
  notifySms: boolean;
  notifyWhatsapp: boolean;
}

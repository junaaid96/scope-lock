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
  settings: { aiEnabled: boolean; reminderHoursBeforeExpiry: number[] };
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
}

export interface ChangeDetail extends ChangeListItem {
  projectId: string;
  description: string;
  source: string;
  classificationRationale: string | null;
  submitterId: string;
  bundleId: string | null;
  decidedAt: string | null;
  impacts: Impact[];
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
  package?: ReviewPackage;
  createdAt: string;
}

export interface Decision {
  id: string;
  decision: string;
  comment: string | null;
  approverEmail: string | null;
  checksum: string;
  createdAt: string;
}

export interface ReviewPackage {
  title: string | null;
  changeId: string | null;
  bundleId: string | null;
  request: { number: string; title: string; description: string; source: string; classification: string | null } | null;
  members: Array<{ changeId: string; number: string; title: string; description: string }>;
  impact: Impact | null;
  requirements: Array<{ requirementId: string; stableKey: string; title: string; description: string; acceptanceCriteria: string[]; versionSequence: number }>;
  attachments: Array<{ fileName: string; contentType: string; sizeBytes: number }>;
  assumptions: string[];
  exclusions: string[];
  sentAt: string;
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

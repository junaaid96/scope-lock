/**
 * External provider interface: Linear/Jira plug in behind this shape later.
 * Providers normalize their webhooks into minimal observed work — identifiers
 * only, never file contents or full payloads — and verify their own
 * signatures. Nothing here changes scope state; callers decide what to store.
 */
export type ExternalWorkKind = "PULL_REQUEST" | "PUSH";

export interface ObservedWork {
  provider: string;
  /** Stable provider-side identifier, e.g. `octo/repo#12` or a commit sha. */
  externalId: string;
  kind: ExternalWorkKind;
  url: string | null;
  /** Short human label (PR title, commit subject). Never trusted input. */
  title: string | null;
  /** Canonical `CHG-###` / `REQ-###` identifiers parsed from provider text. */
  refs: string[];
  /** True when the work landed (merged PR, push to the default branch). */
  merged: boolean;
  mergedAt: string | null;
}

export interface ProviderHeaders {
  signature256?: string;
}

export interface ExternalProvider {
  readonly name: string;
  /** Throw (DomainError) when the delivery signature is missing or invalid. */
  verifySignature(secret: string, rawBody: string, headers: ProviderHeaders): void;
  /**
   * Normalize one webhook delivery. Unknown event names return [] so
   * providers can add events without breaking intake; malformed payloads
   * for known events throw.
   */
  parseEvent(event: string, payload: unknown): ObservedWork[];
}

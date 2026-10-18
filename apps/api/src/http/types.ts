import type { Request } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { User } from "../store/index.js";

export interface AuthInfo {
  user: User;
  sessionId: string;
  viaCookie: boolean;
  /** Set for API-key requests: the key id (for rate limits) and its scopes. */
  apiKeyId: string | null;
  scopes: string[] | null;
}

export interface ApiRequest extends Request {
  auth?: AuthInfo;
  validatedQuery?: Record<string, unknown>;
  startTime?: number;
  /** Raw JSON body, captured for webhook HMAC verification. */
  rawBody?: string;
}

/** express.json verify callback: stash the raw body for HMAC checks. */
export function captureRawBody(req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  (req as unknown as { rawBody?: string }).rawBody = buf.toString("utf8");
}

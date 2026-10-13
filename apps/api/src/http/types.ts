import type { Request } from "express";
import type { User } from "../store/index.js";

export interface AuthInfo {
  user: User;
  sessionId: string;
  viaCookie: boolean;
}

export interface ApiRequest extends Request {
  auth?: AuthInfo;
  validatedQuery?: Record<string, unknown>;
  startTime?: number;
}

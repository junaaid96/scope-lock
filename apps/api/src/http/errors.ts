import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { DomainError, type DomainErrorCode } from "@scopelock/domain";
import { getCorrelationId } from "../context.js";
import { logger } from "../logger.js";

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
};

export function sendError(res: Response, status: number, code: string, message: string, details?: Record<string, unknown>): void {
  const correlationId = getCorrelationId();
  res.status(status).json({ error: { code, message, correlationId, ...(details ? { details } : {}) } });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof DomainError) {
    sendError(res, STATUS_BY_CODE[err.code], err.code, err.message, err.details);
    return;
  }
  if (err instanceof ZodError) {
    sendError(res, 400, "VALIDATION_ERROR", "Request validation failed", {
      issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message, code: i.code })),
    });
    return;
  }
  if (err instanceof SyntaxError && "body" in (err as unknown as Record<string, unknown>)) {
    sendError(res, 400, "INVALID_JSON", "Request body is not valid JSON");
    return;
  }
  logger.error("Unhandled error", { message: err instanceof Error ? err.message : String(err) });
  const correlationId = getCorrelationId();
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong", correlationId } });
}

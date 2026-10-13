import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";
import type { ApiRequest } from "./types.js";

/** Validate req.body against a Zod schema; replaces body with the parsed value. */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body) as unknown;
    next();
  };
}

/** Validate req.params against a Zod schema. */
export function validateParams(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.params = schema.parse(req.params) as Record<string, string>;
    next();
  };
}

/** Validate req.query; parsed values are stored on req.validatedQuery. */
export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    (req as ApiRequest).validatedQuery = schema.parse(req.query) as Record<string, unknown>;
    next();
  };
}

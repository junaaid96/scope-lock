import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import { newCorrelationId } from "@scopelock/domain";
import type { AppContext } from "./app-context.js";
import { getEnv } from "./env.js";
import { runWithContext } from "./context.js";
import { logger } from "./logger.js";
import { errorMiddleware, sendError } from "./http/errors.js";
import { rateLimit } from "./http/rate-limit.js";
import { captureRawBody } from "./http/types.js";
import { authRoutes, sessionMeHandler } from "./modules/auth.js";
import { authenticate, requireAuth } from "./http/auth.js";
import { asyncHandler } from "./http/errors.js";
import openapiSpec from "./openapi.json" with { type: "json" };
import { organizationRoutes } from "./modules/organizations.js";
import { apiKeyRoutes } from "./modules/api-keys.js";
import { webhookRoutes } from "./modules/webhooks.js";
import { clientRoutes } from "./modules/clients.js";
import { projectRoutes } from "./modules/projects.js";
import { scopeRoutes } from "./modules/scope.js";
import { requirementRoutes } from "./modules/requirements.js";
import { changeRoutes } from "./modules/changes.js";
import { lifecycleRoutes } from "./modules/lifecycle.js";
import { approvalRoutes } from "./modules/approvals.js";
import { changeOrderRoutes } from "./modules/change-order.js";
import { fileRoutes } from "./modules/files.js";
import { aiRoutes } from "./modules/ai-routes.js";
import { activityRoutes } from "./modules/activity.js";
import { ledgerRoutes } from "./modules/ledger.js";
import { pricingRoutes } from "./modules/pricing.js";
import { allowanceRoutes } from "./modules/allowance.js";
import { intakeRoutes } from "./modules/intake.js";
import { inboundRoutes } from "./modules/inbound.js";
import { notificationRoutes } from "./modules/notifications.js";
import { externalRoutes } from "./modules/external.js";
import { githubRoutes } from "./modules/github.js";
import { memoryRoutes } from "./modules/memory.js";

export function createApp(ctx: AppContext): Express {
  const app = express();
  const env = ctx.env ?? getEnv();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(
    cors({
      origin: [env.WEB_URL],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key", "X-Request-Id"],
    }),
  );
  app.use(cookieParser());
  // Correlation context first so every log/audit carries the request id.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const correlationId =
      (req.headers["x-request-id"] as string | undefined)?.slice(0, 64) || newCorrelationId();
    res.setHeader("X-Request-Id", correlationId);
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip ?? undefined;
    runWithContext({ correlationId, ip }, () => {
      const start = Date.now();
      res.on("finish", () => {
        logger.info("request", {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms: Date.now() - start,
        });
      });
      next();
    });
  });
  const jsonParser = express.json({ limit: "2mb", verify: captureRawBody });
  // Webhook routes parse their own (larger, attachment-bearing) bodies.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/v1/webhooks/")) return next();
    return jsonParser(req, res, next);
  });
  app.set("scopelock.env", env);
  app.use("/api/", rateLimit(env, "default"));

  // Liveness + readiness (no auth).
  app.get("/api/openapi.json", (_req, res) => res.json(openapiSpec));
  app.get("/healthz", (_req, res) => res.json({ ok: true, version: "0.1.0" }));
  app.get("/readyz", (_req, res) => {
    void ctx.store
      .listNotifications("__readiness__", { limit: 1 })
      .then(() => res.json({ ok: true }))
      .catch(() => sendError(res, 503, "NOT_READY", "Storage is not ready"));
  });

  const v1 = express.Router();
  v1.use("/auth", authRoutes(ctx));
  // Plan §9 session alias: GET /me mirrors GET /auth/me.
  v1.get("/me", authenticate(ctx.store), requireAuth, asyncHandler(sessionMeHandler(ctx)));
  v1.use("/organizations", organizationRoutes(ctx));
  v1.use("/organizations", apiKeyRoutes(ctx));
  v1.use("/organizations", webhookRoutes(ctx));
  v1.use("/clients", clientRoutes(ctx));
  v1.use("/projects", projectRoutes(ctx));
  v1.use(scopeRoutes(ctx));
  v1.use(requirementRoutes(ctx));
  v1.use(changeRoutes(ctx));
  v1.use(lifecycleRoutes(ctx));
  v1.use(approvalRoutes(ctx));
  v1.use(changeOrderRoutes(ctx));
  v1.use(fileRoutes(ctx));
  v1.use(aiRoutes(ctx));
  v1.use(activityRoutes(ctx));
  v1.use(ledgerRoutes(ctx));
  v1.use(pricingRoutes(ctx));
  v1.use(allowanceRoutes(ctx));
  v1.use(intakeRoutes(ctx));
  v1.use(inboundRoutes(ctx));
  v1.use(notificationRoutes(ctx));
  v1.use(externalRoutes(ctx));
  v1.use(githubRoutes(ctx));
  v1.use(memoryRoutes(ctx));
  app.use("/api/v1", v1);

  app.use((_req, res) => sendError(res, 404, "NOT_FOUND", "Not found"));
  app.use(errorMiddleware);
  return app;
}

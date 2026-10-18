import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { agencyFixture, createTestApp } from "./helpers.js";
import { completeWithFailover, resolveProviders } from "../src/modules/ai/providers.js";

afterEach(() => {
  delete process.env.GROQ_BASE_URL;
  delete process.env.OPENAI_BASE_URL;
});

function stub(responder: (body: Record<string, unknown>, res: ServerResponse) => void): Promise<{ server: Server; url: string }> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      responder(body, res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function envelope(content: string): Record<string, unknown> {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

describe("AI provider seam", () => {
  it("orders configured providers with AI_PROVIDER first", () => {
    const { ctx } = createTestApp();
    ctx.env.GROQ_API_KEY = "g";
    ctx.env.OPENAI_API_KEY = "o";
    ctx.env.AI_PROVIDER = "groq";
    expect(resolveProviders(ctx.env).map((p) => p.name)).toEqual(["groq", "openai"]);
    ctx.env.AI_PROVIDER = "openai";
    expect(resolveProviders(ctx.env).map((p) => p.name)).toEqual(["openai", "groq"]);
    ctx.env.GROQ_API_KEY = "";
    expect(resolveProviders(ctx.env).map((p) => p.name)).toEqual(["openai"]);
    ctx.env.OPENAI_API_KEY = "";
    expect(resolveProviders(ctx.env)).toEqual([]);
  });

  it("fails over to the next provider and logs who served", async () => {
    const groq = await stub((_body, res) => {
      res.statusCode = 400; // non-retryable: fail over immediately
      res.end("bad request");
    });
    const openai = await stub((_body, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(envelope(JSON.stringify({ questions: ["What is the deadline?"] }))));
    });
    try {
      const { app, ctx } = createTestApp();
      ctx.env.GROQ_API_KEY = "test-groq";
      ctx.env.OPENAI_API_KEY = "test-openai";
      ctx.env.OPENAI_MODEL = "stub-model";
      ctx.env.AI_PROVIDER = "groq";
      process.env.GROQ_BASE_URL = groq.url;
      process.env.OPENAI_BASE_URL = openai.url;
      const fx = await agencyFixture(app);
      const change = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
        title: "Failover probe",
        description: "Probe description",
        source: "AGENCY",
      });
      const clarify = await fx.owner.agent.post(`/api/v1/change-requests/${change.body.id as string}/ai/clarifications`).send({});
      expect(clarify.status).toBe(200);
      expect(clarify.body.analysis.status).toBe("SUCCEEDED");
      expect(clarify.body.analysis.provider).toBe("openai");
      expect(clarify.body.analysis.model).toBe("stub-model");
    } finally {
      groq.server.close();
      openai.server.close();
    }
  });

  it("throws the last error when every provider fails", async () => {
    const bad = await stub((_body, res) => {
      res.statusCode = 400;
      res.end("nope");
    });
    try {
      const { ctx } = createTestApp();
      ctx.env.GROQ_API_KEY = "x";
      ctx.env.OPENAI_API_KEY = "y";
      process.env.GROQ_BASE_URL = bad.url;
      process.env.OPENAI_BASE_URL = bad.url;
      await expect(completeWithFailover(resolveProviders(ctx.env), ctx.env, { system: "s", user: "u" })).rejects.toThrow(
        /status 400/,
      );
      await expect(completeWithFailover([], ctx.env, { system: "s", user: "u" })).rejects.toThrow(/No AI provider/);
    } finally {
      bad.server.close();
    }
  });
});

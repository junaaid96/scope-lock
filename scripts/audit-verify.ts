/* global process, console */
// Verify a project's tamper-evident audit hash chain from the server side.
// Reads the live store (DATABASE_URL or DATA_FILE from .env), recomputes
// every link, and exits non-zero when the chain is broken.
//
// Usage:
//   npm run audit:verify -- --project <projectId> [--org <organizationId>]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { auditChainKey, verifyAuditChain } from "@scopelock/domain";
import { getEnv } from "../apps/api/src/env.js";
import { createStore } from "../apps/api/src/store/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadDotEnv(path: string): void {
  try {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      const k = key?.trim();
      if (!k || process.env[k] !== undefined) continue;
      let v = rest.join("=").trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  } catch {
    // ignore
  }
}

function usage(): never {
  console.error("Usage: npm run audit:verify -- --project <projectId> [--org <organizationId>]");
  process.exit(2);
}

async function main(): Promise<void> {
  loadDotEnv(join(HERE, "..", ".env"));
  const args = process.argv.slice(2);
  const projectIdx = args.indexOf("--project");
  if (projectIdx === -1 || !args[projectIdx + 1]) usage();
  const projectId = args[projectIdx + 1] as string;
  const orgIdx = args.indexOf("--org");
  const orgOverride = orgIdx === -1 ? undefined : args[orgIdx + 1];
  if (orgIdx !== -1 && !orgOverride) usage();

  const env = getEnv();
  const store = await createStore(env);
  {
    const project = await store.findProjectById(projectId);
    if (!project) {
      console.error(`Project not found: ${projectId}`);
      process.exit(2);
    }
    if (orgOverride && project.organizationId !== orgOverride) {
      console.error(`Project ${projectId} is not in organization ${orgOverride}`);
      process.exit(2);
    }
    const chainKey = auditChainKey({ projectId, organizationId: project.organizationId });
    const [events, head] = await Promise.all([store.listAuditChain(chainKey), store.getAuditChainHead(chainKey)]);
    const result = verifyAuditChain(events);
    const tail = result.checked === 0 ? null : events.filter((e) => e.chainSeq > 0).at(-1) ?? null;
    let { valid, breakAtSeq, reason } = result;
    if (valid && head && tail && (head.headHash !== tail.hash || head.eventCount !== tail.chainSeq)) {
      valid = false;
      breakAtSeq = tail.chainSeq;
      reason = "chain head disagrees with recomputed history";
    }
    if (valid && !head && tail) {
      valid = false;
      breakAtSeq = tail.chainSeq;
      reason = "chained events exist but the chain head is missing";
    }
    console.log(`chain: ${chainKey}`);
    console.log(`events: ${events.length} (chained: ${result.checked}, legacy: ${result.legacy})`);
    console.log(`head: ${head ? `${head.headHash.slice(0, 16)}… seq ${head.eventCount}` : "none"}`);
    if (valid) {
      console.log("result: VALID");
    } else {
      console.log(`result: BROKEN at seq ${String(breakAtSeq)}: ${reason ?? "unknown"}`);
      process.exit(1);
    }
  }
  process.exit(0);
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

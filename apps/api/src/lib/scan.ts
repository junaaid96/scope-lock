import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Env } from "../env.js";
import type { StorageDriver } from "./storage.js";
import { logger } from "../logger.js";

export type ScanVerdict = "CLEAN" | "INFECTED" | "SKIPPED";

export interface ScanResult {
  verdict: ScanVerdict;
  reason: string | null;
  /** Local driver only: the true SHA-256 of the stored bytes. */
  actualSha256: string | null;
}

// Standard antivirus test signature — universally flagged, harmless by design.
// Assembled from parts so this source file itself does not match the signature.
const EICAR = ["X5O!P%@AP[4", "\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");

/** MZ (Windows) and ELF (Linux) executable headers. No allowed upload type is executable. */
function hasExecutableMagic(bytes: Buffer): boolean {
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return true;
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) {
    return true;
  }
  return false;
}

function containsEicar(bytes: Buffer): boolean {
  return bytes.includes(EICAR, 0, "latin1");
}

/**
 * Consult an external malware scanner (e.g. a ClamAV REST sidecar) configured
 * via MALWARE_SCANNER_URL. Expected protocol: POST JSON, respond
 * `{ "verdict": "CLEAN" | "INFECTED" }`. Fails closed on transport errors.
 */
async function externalScan(env: Env, payload: Record<string, unknown>): Promise<"CLEAN" | "INFECTED"> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(env.MALWARE_SCANNER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`scanner HTTP ${res.status}`);
    const data = (await res.json()) as { verdict?: unknown };
    if (data.verdict === "CLEAN" || data.verdict === "INFECTED") return data.verdict;
    throw new Error("scanner returned an unknown verdict");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Malware gate for completed uploads. Local bytes are inspected directly
 * (EICAR + executable-magic heuristics, then the external scanner when
 * configured). Object-storage bytes cannot be read cheaply, so R2 uploads
 * rely on the external scanner and are marked SKIPPED without one.
 */
export async function scanUpload(
  env: Env,
  storage: StorageDriver,
  storageKey: string,
  declaredContentType: string,
): Promise<ScanResult> {
  if (storage.name === "local") {
    const bytes = readFileSync(`${env.UPLOAD_DIR}/${storageKey}`);
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (containsEicar(bytes)) {
      return { verdict: "INFECTED", reason: "EICAR test signature detected", actualSha256 };
    }
    if (hasExecutableMagic(bytes)) {
      return { verdict: "INFECTED", reason: "executable content is never allowed", actualSha256 };
    }
    if (env.MALWARE_SCANNER_URL) {
      const verdict = await externalScan(env, {
        sha256: actualSha256,
        sizeBytes: bytes.length,
        contentType: declaredContentType,
      });
      return {
        verdict,
        reason: verdict === "INFECTED" ? "external scanner flagged the upload" : null,
        actualSha256,
      };
    }
    return { verdict: "CLEAN", reason: null, actualSha256 };
  }
  if (env.MALWARE_SCANNER_URL) {
    const verdict = await externalScan(env, { bucket: env.R2_BUCKET_NAME, key: storageKey });
    return {
      verdict,
      reason: verdict === "INFECTED" ? "external scanner flagged the upload" : null,
      actualSha256: null,
    };
  }
  logger.warn("Upload scan skipped: no malware scanner configured for object storage");
  return { verdict: "SKIPPED", reason: "no scanner configured for object storage", actualSha256: null };
}

/** Constant-time checksum comparison for upload integrity. */
export function checksumsMatch(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase(), "hex");
  const y = Buffer.from(b.toLowerCase(), "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

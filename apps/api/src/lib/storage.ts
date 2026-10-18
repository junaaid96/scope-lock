import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { newId } from "@scopelock/domain";
import type { Env } from "../env.js";
import { usesR2 } from "../env.js";

export interface PresignedUpload {
  storageKey: string;
  uploadUrl: string;
  expiresAt: string;
  /** Local-driver only: where the client PUTs bytes (relative API path). */
  localPath: string | null;
}

export interface StorageDriver {
  readonly name: "r2" | "local";
  createUploadUrl(fileName: string, contentType: string, sizeBytes: number): Promise<PresignedUpload>;
  createDownloadUrl(storageKey: string, fileName: string): Promise<{ downloadUrl: string; expiresAt: string }>;
  /** Server-side byte write (inbound email attachments). Key must come from createUploadUrl. */
  putBytes(storageKey: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Best-effort byte removal for retention GC. Never throws on missing keys. */
  deleteBytes(storageKey: string): Promise<void>;
}

const URL_TTL_SECONDS = 15 * 60;

class R2StorageDriver implements StorageDriver {
  readonly name = "r2" as const;
  private readonly client: S3Client;
  constructor(private readonly env: Env) {
    this.client = new S3Client({
      region: "auto",
      endpoint: env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    });
  }

  async createUploadUrl(fileName: string, contentType: string, _sizeBytes: number): Promise<PresignedUpload> {
    const storageKey = `attachments/${newId("file")}/${sanitize(fileName)}`;
    const command = new PutObjectCommand({
      Bucket: this.env.R2_BUCKET_NAME,
      Key: storageKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: URL_TTL_SECONDS });
    return { storageKey, uploadUrl, expiresAt: ttl(), localPath: null };
  }

  async createDownloadUrl(storageKey: string, fileName: string): Promise<{ downloadUrl: string; expiresAt: string }> {
    const command = new GetObjectCommand({
      Bucket: this.env.R2_BUCKET_NAME,
      Key: storageKey,
      ResponseContentDisposition: `attachment; filename="${sanitize(fileName)}"`,
    });
    const downloadUrl = await getSignedUrl(this.client, command, { expiresIn: URL_TTL_SECONDS });
    return { downloadUrl, expiresAt: ttl() };
  }

  async putBytes(storageKey: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.env.R2_BUCKET_NAME, Key: storageKey, Body: bytes, ContentType: contentType }),
    );
  }

  async deleteBytes(storageKey: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.env.R2_BUCKET_NAME, Key: storageKey }));
  }
}

/**
 * Local driver for development/tests: files are PUT to an API endpoint that
 * verifies the signed intent before writing under UPLOAD_DIR (never served
 * statically — downloads go through an authorized API route).
 */
class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;
  constructor(private readonly env: Env) {
    mkdirSync(env.UPLOAD_DIR, { recursive: true });
  }

  async createUploadUrl(fileName: string, _contentType: string, _sizeBytes: number): Promise<PresignedUpload> {
    const storageKey = `attachments/${newId("file")}/${sanitize(fileName)}`;
    const expiresAt = ttl();
    const sig = sign(this.env.AUTH_SECRET || "local-dev", `${storageKey}:${expiresAt}`);
    const params = new URLSearchParams({ key: storageKey, expires: expiresAt, sig });
    return {
      storageKey,
      uploadUrl: `${this.env.API_URL}/api/v1/files/local-upload?${params.toString()}`,
      expiresAt,
      localPath: `/api/v1/files/local-upload?${params.toString()}`,
    };
  }

  async createDownloadUrl(storageKey: string, _fileName: string): Promise<{ downloadUrl: string; expiresAt: string }> {
    const expiresAt = ttl();
    const sig = sign(this.env.AUTH_SECRET || "local-dev", `${storageKey}:${expiresAt}`);
    const params = new URLSearchParams({ key: storageKey, expires: expiresAt, sig });
    return { downloadUrl: `${this.env.API_URL}/api/v1/files/local-download?${params.toString()}`, expiresAt };
  }

  async deleteBytes(storageKey: string): Promise<void> {
    if (storageKey.includes("..") || storageKey.startsWith("/")) return;
    rmSync(`${this.env.UPLOAD_DIR}/${storageKey}`, { force: true });
  }

  async putBytes(storageKey: string, bytes: Buffer): Promise<void> {
    if (storageKey.includes("..") || storageKey.startsWith("/") || !storageKey.startsWith("attachments/")) {
      throw new Error("Refusing to write outside the attachments directory");
    }
    const full = `${this.env.UPLOAD_DIR}/${storageKey}`;
    mkdirSync(full.slice(0, full.lastIndexOf("/")), { recursive: true });
    writeFileSync(full, bytes);
  }
}

export function verifyLocalSignature(secret: string, storageKey: string, expires: string, sig: string): boolean {
  if (!secret || !storageKey || !expires || !sig) return false;
  if (Date.parse(expires) <= Date.now()) return false;
  if (storageKey.includes("..") || storageKey.startsWith("/")) return false;
  const expected = sign(secret, `${storageKey}:${expires}`);
  return timingSafeEqualHex(expected, sig);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return createHash("sha256").update(ba).digest("hex") === createHash("sha256").update(bb).digest("hex");
}

function sign(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
}

function ttl(): string {
  return new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString();
}

export function createStorageDriver(env: Env): StorageDriver {
  return usesR2(env) ? new R2StorageDriver(env) : new LocalStorageDriver(env);
}

export function localFileExists(env: Env, storageKey: string): boolean {
  return existsSync(`${env.UPLOAD_DIR}/${storageKey}`);
}

/** Allowed upload types (extension + content-type prefix allowlist). */
const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "text/",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/zip",
  "application/json",
  "application/msword",
  "application/vnd.openxmlformats",
  "application/vnd.ms-",
];

export function assertAllowedUpload(contentType: string, sizeBytes: number, maxBytes: number): void {
  const allowed = ALLOWED_CONTENT_TYPES.some((p) => contentType.toLowerCase().startsWith(p));
  if (!allowed) throw new Error(`Content type not allowed: ${contentType}`);
  if (sizeBytes > maxBytes) throw new Error(`File exceeds the ${maxBytes} byte limit`);
}

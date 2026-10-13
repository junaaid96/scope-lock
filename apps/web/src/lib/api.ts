export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, correlationId: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;
    this.details = details;
  }
}

const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { headers: initHeaders, ...rest } = init ?? {};
  const res = await fetch(`${BASE}/api/v1${path}`, {
    credentials: "include",
    ...rest,
    headers: { "content-type": "application/json", ...(initHeaders ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code: string; message: string; correlationId: string; details?: Record<string, unknown> };
  } & T;
  if (!res.ok) {
    const err = (body as { error?: ApiError }).error;
    throw new ApiError(res.status, err?.code ?? "ERROR", err?.message ?? `Request failed (${res.status})`, err?.correlationId ?? "", err?.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: data === undefined ? undefined : JSON.stringify(data), headers }),
  patch: <T>(path: string, data?: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface Page<T> {
  data: T[];
  pagination: { nextCursor: string | null };
}

/** Fetch all pages of a cursor-paginated list (bounded to 500 items for UI lists). */
export async function fetchAll<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined;
  for (let i = 0; i < 10; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page = await request<Page<T>>(`${path}${sep}limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...page.data);
    cursor = page.pagination.nextCursor;
    if (!cursor) break;
  }
  return out;
}

/** Raw byte PUT to a presigned upload URL (local signed path or R2 URL). */
export async function putBytes(uploadUrl: string, bytes: ArrayBuffer, contentType: string): Promise<{ checksumSha256: string; sizeBytes: number }> {
  let path = uploadUrl;
  try {
    const u = new URL(uploadUrl);
    // Same-origin signed paths go through the dev proxy / API base.
    if (typeof window !== "undefined" && (u.origin === window.location.origin || u.pathname.startsWith("/api/"))) {
      path = u.pathname + u.search;
    }
  } catch {
    // Relative URL: use as-is.
  }
  const res = await fetch(path, { method: "PUT", credentials: "include", headers: { "content-type": contentType }, body: bytes });
  if (!res.ok) throw new ApiError(res.status, "UPLOAD_FAILED", `Upload failed (${res.status})`, "");
  return (await res.json().catch(() => ({}))) as { checksumSha256: string; sizeBytes: number };
}

/** Browser SHA-256 for upload integrity. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}

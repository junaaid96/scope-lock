// Typed domain errors. The API maps these to HTTP status codes + the error envelope.
export type DomainErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "CONFLICT"
  | "UNPROCESSABLE"
  | "BAD_REQUEST"
  | "RATE_LIMITED"
  | "GONE";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }

  static notFound(message = "Not found", details?: Record<string, unknown>): DomainError {
    return new DomainError("NOT_FOUND", message, details);
  }
  static forbidden(message = "Forbidden", details?: Record<string, unknown>): DomainError {
    return new DomainError("FORBIDDEN", message, details);
  }
  static unauthorized(message = "Unauthorized", details?: Record<string, unknown>): DomainError {
    return new DomainError("UNAUTHORIZED", message, details);
  }
  static conflict(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError("CONFLICT", message, details);
  }
  static unprocessable(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError("UNPROCESSABLE", message, details);
  }
  static badRequest(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError("BAD_REQUEST", message, details);
  }
  static gone(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError("GONE", message, details);
  }
  static rateLimited(message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError("RATE_LIMITED", message, details);
  }
}

import { randomUUID } from "node:crypto";

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "PROJECT_NOT_FOUND"
  | "WORKSPACE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "VERSION_CONFLICT"
  | "INVALID_STATE"
  | "CLASSIFICATION_BLOCKED"
  | "INTERNAL_ERROR";

export interface ApiError {
  code: AppErrorCode;
  message: string;
  correlationId: string;
  details: Record<string, unknown>;
}

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const newCorrelationId = () => randomUUID();

/** Consistent, stack-free error envelope for route handlers and server actions. */
export function toApiError(err: unknown, correlationId = newCorrelationId()): ApiError {
  if (err instanceof AppError) return { code: err.code, message: err.message, correlationId, details: err.details };
  if (err && typeof err === "object" && "code" in err && (err as { code: unknown }).code === "PERMISSION_DENIED") {
    return { code: "PERMISSION_DENIED", message: (err as unknown as Error).message, correlationId, details: {} };
  }
  return { code: "INTERNAL_ERROR", message: "The request could not be completed. Quote the correlation ID when contacting support.", correlationId, details: {} };
}

export const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  PROJECT_NOT_FOUND: 404,
  WORKSPACE_NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  VERSION_CONFLICT: 409,
  INVALID_STATE: 409,
  CLASSIFICATION_BLOCKED: 403,
  INTERNAL_ERROR: 500,
};

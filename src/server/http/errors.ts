import type { ErrorCode } from "@/generated/types.gen";

/*
 * The single error envelope from the contract. Handlers throw these; the
 * contract wrapper turns them into responses, so no handler builds an error
 * body by hand and they cannot drift apart.
 */

export type FieldIssue = { path: string; message: string };

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: FieldIssue[];
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: FieldIssue[] | undefined;

  constructor(status: number, code: ErrorCode, message: string, details?: FieldIssue[]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toBody(): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export class ValidationError extends ApiError {
  constructor(message = "The request failed validation.", details?: FieldIssue[]) {
    super(400, "validation_failed", message, details);
    this.name = "ValidationError";
  }
}

export class UnauthenticatedError extends ApiError {
  constructor(message = "Sign in to continue.") {
    super(401, "unauthenticated", message);
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "You do not have access to this.") {
    super(403, "forbidden", message);
    this.name = "ForbiddenError";
  }
}

export class AccountDeactivatedError extends ApiError {
  constructor(message = "This account has been deactivated.") {
    /*
     * Sessions are JWTs, so one issued before deactivation stays valid.
     * Checked per request rather than at sign-in.
     */
    super(403, "account_deactivated", message);
    this.name = "AccountDeactivatedError";
  }
}

/* Signed in with Google but not yet let in by an admin (#249). */
export class AccountPendingError extends ApiError {
  constructor(message = "This account is waiting for an admin's approval.") {
    super(403, "account_pending", message);
    this.name = "AccountPendingError";
  }
}

/* An admin turned the request down; only an admin can unblock it (#249). */
export class AccountBlockedError extends ApiError {
  constructor(message = "This account's request wasn't approved.") {
    super(403, "account_blocked", message);
    this.name = "AccountBlockedError";
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found.") {
    super(404, "not_found", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends ApiError {
  constructor(code: ErrorCode = "conflict", message = "That conflicts with the current state.") {
    super(409, code, message);
    this.name = "ConflictError";
  }
}

export class UnsupportedMediaTypeError extends ApiError {
  /* 415, not 400: the sync engine quarantines a lone record refused with 400. */
  constructor(message = "Send the request body as JSON.") {
    super(415, "unsupported_media_type", message);
    this.name = "UnsupportedMediaTypeError";
  }
}

export class ContentTooLargeError extends ApiError {
  constructor(message = "This request is too large.") {
    super(413, "content_too_large", message);
    this.name = "ContentTooLargeError";
  }
}

export class ClockSkewError extends ApiError {
  constructor(message = "Your clock is out of step with the server.") {
    super(422, "clock_skew", message);
    this.name = "ClockSkewError";
  }
}

export class RateLimitedError extends ApiError {
  constructor(message = "Too many requests. Try again shortly.") {
    super(429, "rate_limited", message);
    this.name = "RateLimitedError";
  }
}

export class InternalError extends ApiError {
  constructor(message = "Something went wrong.") {
    super(500, "internal_error", message);
    this.name = "InternalError";
  }
}

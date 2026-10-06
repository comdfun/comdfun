/** `{"error":"<code>","detail":"…"}` with an HTTP status, exactly as IMD returns them. */
import type { Problem } from "@company/protocol";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  readonly headers: Record<string, string>;
  constructor(status: number, code: string, detail?: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
    super(detail ?? code);
    this.status = status;
    this.code = code;
    this.extra = extra;
    this.headers = headers;
  }
  toJSON() {
    return { error: this.code, detail: this.message, ...this.extra };
  }
}

export const E = {
  invalidId: (detail = "malformed id") => new ApiError(400, "invalid_id", detail),
  invalidQuery: (detail: string) => new ApiError(400, "invalid_query", detail),
  invalidRequest: (detail: string) => new ApiError(400, "invalid_request", detail),
  notFound: (detail = "not found") => new ApiError(404, "not_found", detail),
  featureOff: (detail = "feature off") => new ApiError(404, "feature_off", detail),
  conflict: (code: string, detail: string) => new ApiError(409, code, detail),
  invalidInput: (problems: Problem[]) => new ApiError(422, "invalid_input", problems[0]?.message ?? "input refused", { problems }),
  unavailable: (code: string, detail: string) => new ApiError(503, code, detail),
  unauthorized: (code: string, detail: string) => new ApiError(401, code, detail),
  forbidden: (code: string, detail: string) => new ApiError(403, code, detail),
  tooLarge: (limit: number) => new ApiError(413, "body_over_limit", `body exceeds ${limit} bytes`),
  rate: (code: string, retryAfter: number) => new ApiError(429, code, `limit reached; retry after ${retryAfter}s`, {}, { "retry-after": String(retryAfter) }),
};

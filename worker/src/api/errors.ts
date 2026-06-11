export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function notFound(message = "Requested resource was not found") {
  return new ApiError(404, "not_found", message);
}

export function badRequest(message: string, details?: Record<string, unknown>) {
  return new ApiError(400, "validation_error", message, details);
}

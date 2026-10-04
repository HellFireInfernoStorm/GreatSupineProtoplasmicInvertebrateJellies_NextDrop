import type { ApiError, ApiValidationResult, ErrorCode } from "@nextdrop/contracts";

/**
 * Every failed API call rejects with this.
 * - `http`: the server answered with an error status; `error` holds its body when it is the shared error DTO.
 * - `network`: no answer (offline, DNS, aborted).
 * - `invalid`: the request or the response did not match the contract.
 */
export class ApiRequestError extends Error {
  readonly kind: "http" | "network" | "invalid";
  readonly status: number | null;
  readonly error: ApiError | null;
  readonly validation: ApiValidationResult | null;

  constructor(
    kind: "http" | "network" | "invalid",
    status: number | null,
    error: ApiError | null,
    message: string,
    validation: ApiValidationResult | null = null,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.kind = kind;
    this.status = status;
    this.error = error;
    this.validation = validation;
  }

  get code(): ErrorCode | null {
    return this.error?.code ?? null;
  }
}

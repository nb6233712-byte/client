/**
 * ============================================================================
 * SAFE STRUCTURED ERROR HANDLER & EXCEPTION MAPPING
 * ============================================================================
 * 
 * Compliant with:
 * - FTC Safeguards Rule (16 CFR § 314.4)
 * - OWASP ASVS v4.0.3 (Level 3 - Error Handling & Logging)
 * 
 * NEVER leak internal stack traces, database schema, or credentials to client.
 */

export const ErrorCode = Object.freeze({
  OK: 'ok',
  UNAUTHENTICATED: 'unauthenticated',
  PERMISSION_DENIED: 'permission_denied',
  INVALID_ARGUMENT: 'invalid_argument',
  NOT_FOUND: 'not_found',
  ALREADY_EXISTS: 'already_exists',
  FAILED_PRECONDITION: 'failed_precondition',
  ABORTED: 'aborted',
  OUT_OF_RANGE: 'out_of_range',
  UNAVAILABLE: 'unavailable',
  PROVIDER_ERROR: 'provider_error',
  INTERNAL: 'internal'
});

export class AppError extends Error {
  /**
   * @param {string} code - Member of ErrorCode
   * @param {string} clientMessage - Safe human-readable message for client
   * @param {object} [details] - Non-sensitive error metadata
   * @param {Error} [originalError] - Internal exception (logged internally, not exposed)
   */
  constructor(code, clientMessage, details = {}, originalError = null) {
    super(clientMessage);
    this.name = 'AppError';
    this.code = code || ErrorCode.INTERNAL;
    this.clientMessage = clientMessage;
    this.details = details;
    this.originalError = originalError;
    this.timestamp = new Date().toISOString();
  }

  toResponse() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.clientMessage,
        details: this.details,
        timestamp: this.timestamp
      }
    };
  }
}

/**
 * Helper factory functions for common errors
 */
export function unauthenticated(message = 'Authentication is required for this operation.') {
  return new AppError(ErrorCode.UNAUTHENTICATED, message);
}

export function permissionDenied(message = 'You do not have permission to perform this action.') {
  return new AppError(ErrorCode.PERMISSION_DENIED, message);
}

export function invalidArgument(message, details = {}) {
  return new AppError(ErrorCode.INVALID_ARGUMENT, message, details);
}

export function notFound(message = 'The requested resource was not found.', details = {}) {
  return new AppError(ErrorCode.NOT_FOUND, message, details);
}

export function failedPrecondition(message, details = {}) {
  return new AppError(ErrorCode.FAILED_PRECONDITION, message, details);
}

export function providerError(providerName, message, details = {}) {
  return new AppError(ErrorCode.PROVIDER_ERROR, `${providerName} error: ${message}`, details);
}

export function safeErrorResponse(err) {
  if (err instanceof AppError) {
    return err.toResponse();
  }
  // Sanitize unexpected internal errors
  const safeMessage = 'An unexpected server error occurred. Please contact practice support.';
  return {
    success: false,
    error: {
      code: ErrorCode.INTERNAL,
      message: safeMessage,
      timestamp: new Date().toISOString()
    }
  };
}

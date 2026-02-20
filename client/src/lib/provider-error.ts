export class ProviderRequestError extends Error {
  readonly code: string;

  constructor(message: string, code = 'provider_request_failed') {
    super(message);
    this.name = 'ProviderRequestError';
    this.code = code;
  }
}

export function isProviderRequestError(value: unknown): value is ProviderRequestError {
  return value instanceof ProviderRequestError;
}

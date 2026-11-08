import type { ErrorCode } from './error-codes';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: ErrorCode,
  ) {
    super(message);
  }
}

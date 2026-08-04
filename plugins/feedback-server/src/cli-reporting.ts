import { ConfigurationApiError } from './admin-session.js';

export function reportCliFailure(operation: string, error: unknown): void {
  if (error instanceof ConfigurationApiError) {
    console.error(`${operation} failed: HTTP ${error.status} ${error.code}: ${error.message}`);
  } else {
    console.error(`${operation} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  process.exitCode = 1;
}


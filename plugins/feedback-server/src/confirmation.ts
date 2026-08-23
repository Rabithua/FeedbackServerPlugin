import { createHash, randomUUID } from 'node:crypto';

export const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

interface PendingConfirmation {
  toolName: string;
  payload: unknown;
  payloadHash: string;
  identityHash: string;
  expiresAt: number;
  executionContext?: unknown;
  executor?: ConfirmationExecutor;
}

export type ConfirmationExecutor = (
  payload: unknown,
  executionContext: unknown,
  runtimeContext: unknown,
) => Promise<unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

export function redactPreview(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPreview);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        if (
          /(password|token|device.?key|secret|credential|signed.?url)/i.test(key)
        ) {
          return [key, entry === undefined ? undefined : '[REDACTED]'];
        }
        return [key, redactPreview(entry)];
      }),
    );
  }
  return value;
}

export class ConfirmationStore {
  private readonly pending = new Map<string, PendingConfirmation>();

  public prepare(
    toolName: string,
    payload: unknown,
    identity: unknown,
    now = Date.now(),
    executionContext?: unknown,
    executor?: ConfirmationExecutor,
  ): { confirmationId: string; expiresAt: string } {
    this.prune(now);
    const confirmationId = randomUUID();
    const expiresAt = now + CONFIRMATION_TTL_MS;
    this.pending.set(confirmationId, {
      toolName,
      payload: structuredClone(payload),
      payloadHash: hash(payload),
      identityHash: hash(identity),
      expiresAt,
      ...(executionContext === undefined ? {} : { executionContext }),
      ...(executor === undefined ? {} : { executor }),
    });
    return {
      confirmationId,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  public consume(
    confirmationId: string,
    toolName: string,
    payload: unknown,
    identity: unknown,
    now = Date.now(),
  ): unknown {
    this.prune(now);
    const pending = this.pending.get(confirmationId);
    if (!pending) throw new Error('Confirmation is missing, expired, or already used');
    if (
      pending.toolName !== toolName ||
      pending.payloadHash !== hash(payload) ||
      pending.identityHash !== hash(identity)
    ) {
      throw new Error('Confirmation does not match this action, payload, or connection');
    }
    this.pending.delete(confirmationId);
    return pending.executionContext;
  }

  public async execute(
    confirmationId: string,
    identity: unknown,
    runtimeContext: unknown,
    now = Date.now(),
  ): Promise<unknown> {
    this.prune(now);
    const pending = this.pending.get(confirmationId);
    if (!pending) throw new Error('Confirmation is missing, expired, or already used');
    if (pending.identityHash !== hash(identity)) {
      throw new Error('Confirmation does not match the active account, profile, or endpoint');
    }
    if (!pending.executor) {
      throw new Error('This confirmation supports only the legacy execution protocol');
    }
    this.pending.delete(confirmationId);
    return pending.executor(
      structuredClone(pending.payload),
      pending.executionContext,
      runtimeContext,
    );
  }

  private prune(now: number): void {
    for (const [id, pending] of this.pending) {
      if (pending.expiresAt <= now) this.pending.delete(id);
    }
  }
}

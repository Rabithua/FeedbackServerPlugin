import { hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';
import {
  addPendingTokenRevocation,
  CredentialPersistenceIndeterminateError,
  deleteKeychainCredentials,
  deleteKeychainProfileCredentials,
  KEYCHAIN_ACCOUNT,
  normalizeBaseUrl,
  readPendingTokenRevocations,
  readKeychainCredentials,
  readKeychainProfileCredentials,
  readKeychainReferencedTokenIds,
  removePendingTokenRevocation,
  resumeKeychainCredentialCleanup,
  resumeKeychainProfileCredentialCleanup,
  writeKeychainCredentials,
  writeKeychainProfileCredentials,
  type PendingTokenRevocation,
  type StoredCredentials,
} from './credentials.js';

export const AGENT_SCOPES = [
  'products:read',
  'products:write',
  'products:dangerous',
  'feedback:read',
  'feedback:write',
  'waitlist:read',
  'waitlist:write',
  'waitlist:invite',
  'waitlist:dangerous',
  'catalog:read',
  'catalog:write',
  'catalog:dangerous',
  'releases:read',
  'releases:write',
  'releases:dangerous',
  'attachments:read',
  'diagnostics:read',
  'bark:read',
  'bark:write',
  'webhooks:read',
  'webhooks:write',
  'audit:read',
] as const;

interface Envelope<T> {
  code: string;
  message: string;
  data: T;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  admin?: {
    id: string;
    username: string;
    displayName: string;
    role: 'super_admin' | 'admin';
  };
}

export interface CreatedToken {
  id: string;
  name: string;
  token: string;
  scopes: string[];
  expiresAt: string;
}

export interface ConfigurationDependencies {
  readCredentials: () => Promise<StoredCredentials | undefined>;
  resumeCredentialCleanup: () => Promise<boolean>;
  writeCredentials: (credentials: StoredCredentials) => Promise<void>;
  deleteCredentials: () => Promise<void>;
  login: typeof login;
  createToken: typeof createAgentToken;
  revokeToken: typeof revokeAgentToken;
  logout: typeof logout;
  readPendingRevocations: () => Promise<PendingTokenRevocation[]>;
  readReferencedTokenIds: () => Promise<Set<string>>;
  addPendingRevocation: (entry: PendingTokenRevocation) => Promise<void>;
  removePendingRevocation: (entry: PendingTokenRevocation) => Promise<void>;
}

export class ConfigurationApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class PendingTokenRecoveryError extends Error {
  public constructor(
    public readonly tokenId: string,
    cause: unknown,
  ) {
    super(
      `A FeedbackServer PAT may still be active. Run feedback-server agent revoke-token --id ${tokenId} in a trusted terminal.`,
      { cause },
    );
    this.name = 'PendingTokenRecoveryError';
  }
}

export async function adminSessionRequest<T>(
  baseUrl: string,
  path: string,
  options: {
    method?: string;
    bearer?: string;
    body?: unknown;
  } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.bearer) headers.set('Authorization', `Bearer ${options.bearer}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseUrl}/${path.replace(/^\/+/, '')}`, {
    method: options.method ?? 'GET',
    headers,
    signal: AbortSignal.timeout(15_000),
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const envelope = (await response.json()) as Envelope<T>;
  if (!response.ok || envelope.code !== 'ok') {
    throw new ConfigurationApiError(response.status, envelope.code, envelope.message);
  }
  return envelope.data;
}

export async function promptText(label: string, defaultValue?: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : '';
    const value = (await terminal.question(`${label}${suffix}: `)).trim();
    return value || defaultValue || '';
  } finally {
    terminal.close();
  }
}

type HiddenPasswordInputResult =
  | { status: 'reading' }
  | { status: 'submitted'; value: string }
  | { status: 'cancelled' };

export class HiddenPasswordInput {
  readonly #decoder = new StringDecoder('utf8');
  #value = '';

  public consume(chunk: Uint8Array): HiddenPasswordInputResult {
    for (const character of this.#decoder.write(Buffer.from(chunk))) {
      const codePoint = character.codePointAt(0);
      if (codePoint === 3) return { status: 'cancelled' };
      if (codePoint === 13 || codePoint === 10) {
        return { status: 'submitted', value: this.#value };
      }
      if (codePoint === 127 || codePoint === 8) {
        const characters = Array.from(this.#value);
        characters.pop();
        this.#value = characters.join('');
        continue;
      }
      if (codePoint !== undefined && codePoint >= 32) this.#value += character;
    }
    return { status: 'reading' };
  }
}

export async function promptPassword(label = 'Administrator password'): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error('A TTY is required for hidden password input');
  }
  process.stderr.write(`${label}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    const input = new HiddenPasswordInput();
    const cleanup = () => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stderr.write('\n');
    };
    const onData = (chunk: Buffer) => {
      const result = input.consume(chunk);
      if (result.status === 'reading') return;
      cleanup();
      if (result.status === 'cancelled') reject(new Error('Cancelled'));
      else resolve(result.value);
    };
    process.stdin.on('data', onData);
  });
}

export async function login(
  baseUrl: string,
  identifier: string,
  password: string,
): Promise<LoginResponse> {
  return adminSessionRequest<LoginResponse>(baseUrl, '/admin/auth/login', {
    method: 'POST',
    body: { identifier, password },
  });
}

export async function createAgentToken(
  baseUrl: string,
  accessToken: string,
): Promise<CreatedToken> {
  return adminSessionRequest<CreatedToken>(baseUrl, '/admin/auth/api-tokens', {
    method: 'POST',
    bearer: accessToken,
    body: {
      name: `FeedbackServer Agent ${hostname()}`.slice(0, 160),
      scopes: AGENT_SCOPES,
      expiresInDays: 365,
    },
  });
}

export async function revokeAgentToken(
  baseUrl: string,
  accessToken: string,
  tokenId: string,
): Promise<void> {
  await adminSessionRequest<null>(baseUrl, `/admin/auth/api-tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    bearer: accessToken,
  });
}

export async function logout(baseUrl: string, refreshToken: string): Promise<void> {
  await adminSessionRequest<null>(baseUrl, '/admin/auth/logout', {
    method: 'POST',
    body: { refreshToken },
  });
}

function defaultConfigurationDependencies(profile?: string): ConfigurationDependencies {
  return {
    readCredentials: profile
      ? () => readKeychainProfileCredentials(profile)
      : readKeychainCredentials,
    resumeCredentialCleanup: profile
      ? () => resumeKeychainProfileCredentialCleanup(profile)
      : resumeKeychainCredentialCleanup,
    writeCredentials: profile
      ? (credentials) => writeKeychainProfileCredentials(credentials, profile)
      : writeKeychainCredentials,
    deleteCredentials: profile
      ? () => deleteKeychainProfileCredentials(profile)
      : deleteKeychainCredentials,
    login,
    createToken: createAgentToken,
    revokeToken: revokeAgentToken,
    logout,
    readPendingRevocations: readPendingTokenRevocations,
    readReferencedTokenIds: readKeychainReferencedTokenIds,
    addPendingRevocation: addPendingTokenRevocation,
    removePendingRevocation: removePendingTokenRevocation,
  };
}

function isAlreadyRevoked(error: unknown): boolean {
  return error instanceof ConfigurationApiError && error.status === 404;
}

function pendingRevocation(
  baseUrl: string,
  username: string,
  tokenId: string,
  profile: string,
): PendingTokenRevocation {
  return { baseUrl, username, tokenId, profile };
}

async function revokeOrAcceptMissing(
  baseUrl: string,
  accessToken: string,
  tokenId: string,
  dependencies: ConfigurationDependencies,
): Promise<void> {
  try {
    await dependencies.revokeToken(baseUrl, accessToken, tokenId);
  } catch (error) {
    if (!isAlreadyRevoked(error)) throw error;
  }
}

async function revokePendingAgentTokens(
  credentials: StoredCredentials | undefined,
  baseUrl: string,
  username: string,
  profile: string,
  accessToken: string,
  dependencies: ConfigurationDependencies,
): Promise<void> {
  for (const tokenId of credentials?.pendingRevocationTokenIds ?? []) {
    await dependencies.addPendingRevocation(
      pendingRevocation(baseUrl, username, tokenId, profile),
    );
  }
  const referencedTokenIds = await dependencies.readReferencedTokenIds();
  const entries = await dependencies.readPendingRevocations();
  for (const entry of entries) {
    if (normalizeBaseUrl(entry.baseUrl) !== baseUrl || entry.username !== username) continue;
    if (entry.profile !== undefined && entry.profile !== profile) continue;
    if (entry.tokenId !== credentials?.tokenId) {
      if (!referencedTokenIds.has(entry.tokenId)) {
        await revokeOrAcceptMissing(baseUrl, accessToken, entry.tokenId, dependencies);
      }
    }
    await dependencies.removePendingRevocation(entry);
  }
}

async function compensateUncommittedToken(
  originalError: unknown,
  createdEntry: PendingTokenRevocation,
  previousEntry: PendingTokenRevocation | undefined,
  accessToken: string,
  dependencies: ConfigurationDependencies,
): Promise<never> {
  const errors = [originalError];
  let revoked = false;
  try {
    await revokeOrAcceptMissing(
      createdEntry.baseUrl,
      accessToken,
      createdEntry.tokenId,
      dependencies,
    );
    revoked = true;
  } catch (error) {
    errors.push(error);
  }
  if (revoked) {
    try {
      await dependencies.removePendingRevocation(createdEntry);
    } catch (error) {
      errors.push(error);
    }
  }
  if (previousEntry) {
    try {
      await dependencies.removePendingRevocation(previousEntry);
    } catch (error) {
      errors.push(error);
    }
  }
  if (!revoked) {
    throw new PendingTokenRecoveryError(
      createdEntry.tokenId,
      new AggregateError(errors, 'PAT persistence and compensating revocation failed'),
    );
  }
  if (errors.length === 1) throw originalError;
  throw new AggregateError(errors, 'PAT persistence failed and cleanup was incomplete');
}

export async function configureAgent(input: {
  baseUrl: string;
  username: string;
  password: string;
  profile?: string;
}, dependencies: ConfigurationDependencies = defaultConfigurationDependencies(input.profile)): Promise<StoredCredentials> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const profile = input.profile ?? KEYCHAIN_ACCOUNT;
  const previous = await dependencies.readCredentials();
  if (previous && normalizeBaseUrl(previous.baseUrl) !== baseUrl) {
    throw new Error(
      'FeedbackServer Agent is connected to a different server. Run feedback-server agent disconnect before changing the endpoint.',
    );
  }
  if (previous?.username && previous.username !== input.username) {
    throw new Error(
      'FeedbackServer Agent is connected to a different administrator. Run feedback-server agent disconnect before changing accounts.',
    );
  }
  const session = await dependencies.login(baseUrl, input.username, input.password);
  try {
    await revokePendingAgentTokens(
      previous,
      baseUrl,
      input.username,
      profile,
      session.accessToken,
      dependencies,
    );
    const created = await dependencies.createToken(baseUrl, session.accessToken);
    const createdEntry = pendingRevocation(baseUrl, input.username, created.id, profile);
    const previousEntry = previous?.tokenId
      ? pendingRevocation(baseUrl, input.username, previous.tokenId, profile)
      : undefined;
    try {
      await dependencies.addPendingRevocation(createdEntry);
      if (previousEntry) await dependencies.addPendingRevocation(previousEntry);
    } catch (error) {
      return await compensateUncommittedToken(
        error,
        createdEntry,
        previousEntry,
        session.accessToken,
        dependencies,
      );
    }
    const credentials: StoredCredentials = {
      baseUrl,
      token: created.token,
      tokenId: created.id,
      username: input.username,
      scopes: created.scopes,
      expiresAt: created.expiresAt,
    };
    try {
      await dependencies.writeCredentials(credentials);
    } catch (error) {
      if (error instanceof CredentialPersistenceIndeterminateError) throw error;
      return await compensateUncommittedToken(
        error,
        createdEntry,
        previousEntry,
        session.accessToken,
        dependencies,
      );
    }
    await revokePendingAgentTokens(
      credentials,
      baseUrl,
      input.username,
      profile,
      session.accessToken,
      dependencies,
    );
    return credentials;
  } finally {
    try {
      await dependencies.logout(baseUrl, session.refreshToken);
    } catch (error) {
      console.error(
        `Warning: unable to revoke the temporary refresh session: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

export async function disconnectAgent(input: {
  username: string;
  password: string;
  profile?: string;
}, dependencies: ConfigurationDependencies = defaultConfigurationDependencies(input.profile)): Promise<boolean> {
  if (await dependencies.resumeCredentialCleanup()) return true;
  const stored = await dependencies.readCredentials();
  if (!stored) return false;
  const baseUrl = normalizeBaseUrl(stored.baseUrl);
  const profile = input.profile ?? KEYCHAIN_ACCOUNT;
  const session = await dependencies.login(baseUrl, input.username, input.password);
  try {
    await revokePendingAgentTokens(
      stored,
      baseUrl,
      input.username,
      profile,
      session.accessToken,
      dependencies,
    );
    if (stored.tokenId) {
      await revokeOrAcceptMissing(baseUrl, session.accessToken, stored.tokenId, dependencies);
    }
    await dependencies.deleteCredentials();
    return true;
  } finally {
    try {
      await dependencies.logout(baseUrl, session.refreshToken);
    } catch (error) {
      console.error(
        `Warning: unable to revoke the temporary refresh session: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

export async function revokeAgentTokenById(input: {
  baseUrl: string;
  username: string;
  password: string;
  tokenId: string;
}, dependencies: ConfigurationDependencies = defaultConfigurationDependencies()): Promise<void> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const session = await dependencies.login(baseUrl, input.username, input.password);
  try {
    await revokeOrAcceptMissing(baseUrl, session.accessToken, input.tokenId, dependencies);
    for (const entry of await dependencies.readPendingRevocations()) {
      if (
        normalizeBaseUrl(entry.baseUrl) === baseUrl
        && entry.username === input.username
        && entry.tokenId === input.tokenId
      ) {
        await dependencies.removePendingRevocation(entry);
      }
    }
  } finally {
    try {
      await dependencies.logout(baseUrl, session.refreshToken);
    } catch (error) {
      console.error(
        `Warning: unable to revoke the temporary refresh session: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}

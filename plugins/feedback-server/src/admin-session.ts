import { hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { StringDecoder } from 'node:string_decoder';
import {
  deleteKeychainCredentials,
  normalizeBaseUrl,
  readKeychainCredentials,
  resumeKeychainCredentialCleanup,
  writeKeychainCredentials,
  type StoredCredentials,
} from './credentials.js';

export const AGENT_SCOPES = [
  'products:read',
  'products:write',
  'products:dangerous',
  'feedback:read',
  'feedback:write',
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
  username: string,
  password: string,
): Promise<LoginResponse> {
  return adminSessionRequest<LoginResponse>(baseUrl, '/admin/auth/login', {
    method: 'POST',
    body: { username, password },
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
      name: `Codex MCP ${hostname()}`.slice(0, 160),
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

const defaultConfigurationDependencies: ConfigurationDependencies = {
  readCredentials: readKeychainCredentials,
  resumeCredentialCleanup: resumeKeychainCredentialCleanup,
  writeCredentials: writeKeychainCredentials,
  deleteCredentials: deleteKeychainCredentials,
  login,
  createToken: createAgentToken,
  revokeToken: revokeAgentToken,
  logout,
};

function withPendingTokenRevocations(
  credentials: StoredCredentials,
  tokenIds: string[],
): StoredCredentials {
  const current = { ...credentials };
  delete current.pendingRevocationTokenIds;
  const uniqueTokenIds = [...new Set(tokenIds)].filter((tokenId) => tokenId !== current.tokenId);
  return uniqueTokenIds.length > 0
    ? { ...current, pendingRevocationTokenIds: uniqueTokenIds }
    : current;
}

function isAlreadyRevoked(error: unknown): boolean {
  return error instanceof ConfigurationApiError && error.status === 404;
}

async function revokePendingAgentTokens(
  credentials: StoredCredentials,
  baseUrl: string,
  accessToken: string,
  dependencies: ConfigurationDependencies,
): Promise<StoredCredentials> {
  let current = withPendingTokenRevocations(
    credentials,
    credentials.pendingRevocationTokenIds ?? [],
  );
  for (const tokenId of current.pendingRevocationTokenIds ?? []) {
    try {
      await dependencies.revokeToken(baseUrl, accessToken, tokenId);
    } catch (error) {
      if (!isAlreadyRevoked(error)) throw error;
    }
    current = withPendingTokenRevocations(
      current,
      (current.pendingRevocationTokenIds ?? []).filter((candidate) => candidate !== tokenId),
    );
    await dependencies.writeCredentials(current);
  }
  return current;
}

export async function configureAgent(input: {
  baseUrl: string;
  username: string;
  password: string;
}, dependencies: ConfigurationDependencies = defaultConfigurationDependencies): Promise<StoredCredentials> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  let previous = await dependencies.readCredentials();
  if (previous && normalizeBaseUrl(previous.baseUrl) !== baseUrl) {
    throw new Error(
      'FeedbackServer Agent is connected to a different server. Run agent:disconnect before changing the endpoint.',
    );
  }
  if (previous?.username && previous.username !== input.username) {
    throw new Error(
      'FeedbackServer Agent is connected to a different administrator. Run agent:disconnect before changing accounts.',
    );
  }
  const session = await dependencies.login(baseUrl, input.username, input.password);
  let created: CreatedToken | undefined;
  try {
    previous = previous
      ? await revokePendingAgentTokens(previous, baseUrl, session.accessToken, dependencies)
      : undefined;
    created = await dependencies.createToken(baseUrl, session.accessToken);
    const credentials = withPendingTokenRevocations(
      {
        baseUrl,
        token: created.token,
        tokenId: created.id,
        username: input.username,
        scopes: created.scopes,
        expiresAt: created.expiresAt,
      },
      [
        ...(previous?.pendingRevocationTokenIds ?? []),
        ...(previous?.tokenId ? [previous.tokenId] : []),
      ],
    );
    try {
      await dependencies.writeCredentials(credentials);
    } catch (error) {
      await dependencies.revokeToken(baseUrl, session.accessToken, created.id);
      throw error;
    }
    return await revokePendingAgentTokens(
      credentials,
      baseUrl,
      session.accessToken,
      dependencies,
    );
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
}, dependencies: ConfigurationDependencies = defaultConfigurationDependencies): Promise<boolean> {
  if (await dependencies.resumeCredentialCleanup()) return true;
  let stored = await dependencies.readCredentials();
  if (!stored) return false;
  const baseUrl = normalizeBaseUrl(stored.baseUrl);
  const session = await dependencies.login(baseUrl, input.username, input.password);
  try {
    stored = await revokePendingAgentTokens(stored, baseUrl, session.accessToken, dependencies);
    if (stored.tokenId) {
      await dependencies.revokeToken(baseUrl, session.accessToken, stored.tokenId);
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

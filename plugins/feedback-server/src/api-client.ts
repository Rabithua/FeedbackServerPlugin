import type { StoredCredentials } from './credentials.js';

interface ApiEnvelope<T> {
  code: string;
  message: string;
  data: T;
}

export class FeedbackServerApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly data: unknown,
  ) {
    super(message);
    this.name = 'FeedbackServerApiError';
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  authenticated?: boolean;
  ifMatch?: string;
}

export class FeedbackServerApiClient {
  public constructor(
    private readonly credentials: StoredCredentials,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  public get baseUrl(): string {
    return this.credentials.baseUrl;
  }

  public async request<T>(
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<T> {
    const url = new URL(
      `${this.credentials.baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`,
    );
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers = new Headers({
      Accept: 'application/json',
      'User-Agent': 'FeedbackServer-MCP/0.6.3',
    });
    if (options.authenticated !== false) {
      headers.set('Authorization', `Bearer ${this.credentials.token}`);
    }
    if (options.ifMatch) headers.set('If-Match', options.ifMatch);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: options.method ?? 'GET',
        headers,
        signal: AbortSignal.timeout(15_000),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch (error) {
      throw new FeedbackServerApiError(
        503,
        'connection_failed',
        'Unable to reach FeedbackServer',
        error instanceof Error ? { cause: error.message } : null,
      );
    }

    let envelope: ApiEnvelope<T>;
    try {
      envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
      throw new FeedbackServerApiError(
        response.status,
        'invalid_response',
        'FeedbackServer returned a non-JSON response',
        null,
      );
    }
    if (!response.ok || envelope.code !== 'ok') {
      throw new FeedbackServerApiError(
        response.status,
        envelope.code || 'request_failed',
        envelope.message || `FeedbackServer request failed with HTTP ${response.status}`,
        envelope.data,
      );
    }
    return envelope.data;
  }
}

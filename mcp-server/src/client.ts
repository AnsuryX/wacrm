// ============================================================
// Ansury Systems / wacrm public API client.
//
// Wraps /api/v1 with:
//   - Bearer auth
//   - Configurable timeout (AbortController)
//   - Exponential-backoff retry on 429 / 5xx
//   - Rate-limit header surfacing in errors
//   - Structured WacrmApiError for clean MCP error results
// ============================================================

import type { Config } from './config.js';
import { logger } from './logger.js';

export class WacrmApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, retryAfter?: number) {
    super(message);
    this.name = 'WacrmApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class WacrmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor(config: Pick<Config, 'baseUrl' | 'apiKey' | 'timeoutMs' | 'maxRetries'>) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.maxRetries = config.maxRetries;
  }

  async request<T>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
      requestId?: string;
    } = {},
  ): Promise<{ data: T; meta?: { next_cursor: string | null } }> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const requestId = options.requestId ?? crypto.randomUUID();

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
        'X-Request-Id': requestId,
      };
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
      }

      let res: Response;
      try {
        logger.debug('api_request', { method, path, attempt, requestId });
        res = await fetch(url, {
          method,
          headers,
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        const msg = (err as Error).message;
        const isTimeout = (err as Error).name === 'AbortError';
        logger.warn('api_request_failed', { method, path, attempt, error: msg, requestId });
        if (attempt < this.maxRetries && !isTimeout) {
          await sleep(Math.min(500 * 2 ** attempt, 4000));
          continue;
        }
        throw new WacrmApiError(
          0,
          isTimeout ? 'timeout' : 'network_error',
          isTimeout
            ? `Request to wacrm timed out after ${this.timeoutMs}ms`
            : `Could not reach wacrm at ${this.baseUrl}: ${msg}`,
        );
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      let payload: unknown;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          if (!res.ok) throw new WacrmApiError(res.status, 'internal', text.slice(0, 500));
        }
      }

      // Retry on 429 with Retry-After backoff, or on 5xx.
      if ((res.status === 429 || res.status >= 500) && attempt < this.maxRetries) {
        const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
        const wait = Math.min(retryAfter * 1000, 8000);
        logger.warn('api_retrying', { status: res.status, wait, attempt, requestId });
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const envelope = payload as { error?: { code?: string; message?: string } } | undefined;
        const code = envelope?.error?.code ?? 'internal';
        let message = envelope?.error?.message ?? `Request failed with status ${res.status}`;
        const retryAfterHeader = res.headers.get('Retry-After');
        const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
        if (res.status === 429 && retryAfter) {
          message += ` (rate limited — retry after ${retryAfter}s)`;
        }
        const remaining = res.headers.get('X-RateLimit-Remaining');
        const reset = res.headers.get('X-RateLimit-Reset');
        logger.warn('api_error', { status: res.status, code, requestId, remaining, reset });
        throw new WacrmApiError(res.status, code, message, retryAfter);
      }

      logger.debug('api_response', { status: res.status, method, path, requestId });
      const envelope = payload as { data: T; meta?: { next_cursor: string | null } };
      return { data: envelope.data, meta: envelope.meta };
    }

    // Should never reach here.
    throw new WacrmApiError(0, 'internal', 'Request loop exhausted');
  }

  private async list<T>(
    path: string,
    query: Record<string, string | number | undefined>,
  ): Promise<Paginated<T>> {
    const res = await this.request<T[]>('GET', path, { query });
    return { data: res.data, next_cursor: res.meta?.next_cursor ?? null };
  }

  // --- Identity -----------------------------------------------------

  me(): Promise<{ data: unknown }> {
    return this.request('GET', '/me');
  }

  // --- Messages -----------------------------------------------------

  sendMessage(body: unknown): Promise<{ data: unknown }> {
    return this.request('POST', '/messages', { body });
  }

  listMessages(query: { limit?: number; cursor?: string }): Promise<Paginated<unknown>> {
    return this.list('/messages', query);
  }

  // --- Contacts -----------------------------------------------------

  listContacts(query: {
    limit?: number;
    cursor?: string;
    search?: string;
    tag?: string;
  }): Promise<Paginated<unknown>> {
    return this.list('/contacts', query);
  }

  getContact(id: string): Promise<{ data: unknown }> {
    return this.request('GET', `/contacts/${encodeURIComponent(id)}`);
  }

  createContact(body: unknown): Promise<{ data: unknown }> {
    return this.request('POST', '/contacts', { body });
  }

  updateContact(id: string, body: unknown): Promise<{ data: unknown }> {
    return this.request('PATCH', `/contacts/${encodeURIComponent(id)}`, { body });
  }

  deleteContact(id: string): Promise<{ data: unknown }> {
    return this.request('DELETE', `/contacts/${encodeURIComponent(id)}`);
  }

  // --- Conversations ------------------------------------------------

  listConversations(query: {
    limit?: number;
    cursor?: string;
    status?: string;
    contact_id?: string;
  }): Promise<Paginated<unknown>> {
    return this.list('/conversations', query);
  }

  getConversation(id: string): Promise<{ data: unknown }> {
    return this.request('GET', `/conversations/${encodeURIComponent(id)}`);
  }

  listConversationMessages(
    id: string,
    query: { limit?: number; cursor?: string },
  ): Promise<Paginated<unknown>> {
    return this.list(`/conversations/${encodeURIComponent(id)}/messages`, query);
  }

  // --- Broadcasts ---------------------------------------------------

  sendBroadcast(body: unknown): Promise<{ data: unknown }> {
    return this.request('POST', '/broadcasts', { body });
  }

  listBroadcasts(query: { limit?: number; cursor?: string }): Promise<Paginated<unknown>> {
    return this.list('/broadcasts', query);
  }

  getBroadcast(id: string): Promise<{ data: unknown }> {
    return this.request('GET', `/broadcasts/${encodeURIComponent(id)}`);
  }

  // --- Webhooks -----------------------------------------------------

  listWebhooks(): Promise<{ data: unknown }> {
    return this.request('GET', '/webhooks');
  }

  getWebhook(id: string): Promise<{ data: unknown }> {
    return this.request('GET', `/webhooks/${encodeURIComponent(id)}`);
  }

  createWebhook(body: unknown): Promise<{ data: unknown }> {
    return this.request('POST', '/webhooks', { body });
  }

  updateWebhook(id: string, body: unknown): Promise<{ data: unknown }> {
    return this.request('PATCH', `/webhooks/${encodeURIComponent(id)}`, { body });
  }

  deleteWebhook(id: string): Promise<{ data: unknown }> {
    return this.request('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }
}

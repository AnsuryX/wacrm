// ============================================================
// Configuration — read once at startup from the environment.
//
// Guards follow a defence-in-depth model:
//   1. WACRM_ENABLE_WRITES / WACRM_ENABLE_BROADCASTS  — client-side
//      gate: write/broadcast tools are not even registered unless set.
//   2. WACRM_ALLOWED_SCOPES — optional explicit allowlist that further
//      restricts which tools are visible, independent of what the API
//      key actually carries.
//   3. The API key's own scopes, enforced server-side on every call.
//
// Transport: stdio is always on. HTTP/SSE is opt-in via WACRM_HTTP_PORT.
// ============================================================

export interface Config {
  baseUrl: string;
  apiKey: string;
  enableWrites: boolean;
  enableBroadcasts: boolean;
  enableWebhooks: boolean;
  /** Explicit scope allowlist. Empty = no extra restriction beyond the key's own scopes. */
  scopeFilter: string[];
  /** HTTP port for SSE+HTTP transport. 0 = disabled (stdio only). */
  httpPort: number;
  /** Optional bearer token required to connect via HTTP transport. */
  httpAuthToken: string | null;
  /** Request timeout in ms for API calls. Default 30000. */
  timeoutMs: number;
  /** Maximum retries on transient errors (429 / 5xx). Default 2. */
  maxRetries: number;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function parseScopes(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseScopeFilter(): string[] {
  const explicit = process.env.WACRM_SCOPE_FILTER?.trim();
  const legacy = process.env.WACRM_ALLOWED_SCOPES?.trim();
  return parseScopes(explicit ?? legacy);
}

export const KNOWN_SCOPES = [
  'messages:send',
  'messages:read',
  'contacts:read',
  'contacts:write',
  'conversations:read',
  'broadcasts:send',
  'webhooks:manage',
] as const;

export type KnownScope = (typeof KNOWN_SCOPES)[number];

export function loadConfig(): Config {
  const baseUrlRaw = process.env.WACRM_BASE_URL?.trim();
  const apiKey = process.env.WACRM_API_KEY?.trim();

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push('WACRM_BASE_URL');
  if (!apiKey) missing.push('WACRM_API_KEY');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        `Set WACRM_BASE_URL to your instance URL (e.g. https://crm.example.com) ` +
        `and WACRM_API_KEY to a key from Settings → API keys.`,
    );
  }

  const baseUrl = baseUrlRaw!.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(
      `WACRM_BASE_URL must start with http:// or https:// (got "${baseUrl}").`,
    );
  }

  const enableWrites = truthy(process.env.WACRM_ENABLE_WRITES);
  const enableBroadcasts = truthy(process.env.WACRM_ENABLE_BROADCASTS);
  const enableWebhooks = truthy(process.env.WACRM_ENABLE_WEBHOOKS);

  if (enableBroadcasts && !enableWrites) {
    throw new Error('WACRM_ENABLE_BROADCASTS requires WACRM_ENABLE_WRITES to also be set.');
  }

  const scopeFilter = parseScopeFilter();

  const httpPortRaw = process.env.WACRM_HTTP_PORT?.trim();
  const httpPort = httpPortRaw ? parseInt(httpPortRaw, 10) : 0;
  if (httpPortRaw && (isNaN(httpPort) || httpPort < 1 || httpPort > 65535)) {
    throw new Error(`WACRM_HTTP_PORT must be a valid port number (got "${httpPortRaw}").`);
  }

  const httpAuthToken = process.env.WACRM_HTTP_AUTH_TOKEN?.trim() || null;

  const timeoutMs = parseInt(process.env.WACRM_TIMEOUT_MS ?? '30000', 10) || 30000;
  const maxRetries = parseInt(process.env.WACRM_MAX_RETRIES ?? '2', 10);

  return {
    baseUrl,
    apiKey: apiKey!,
    enableWrites,
    enableBroadcasts,
    enableWebhooks,
    scopeFilter,
    httpPort,
    httpAuthToken,
    timeoutMs,
    maxRetries,
  };
}

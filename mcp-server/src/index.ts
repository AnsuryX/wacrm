#!/usr/bin/env node
// ============================================================
// Ansury Systems MCP Server — entry point.
//
// Transports:
//   stdio  — always on (for Claude Desktop, Cursor, Claude Code etc.)
//   HTTP/SSE — opt-in via WACRM_HTTP_PORT (for web agents, n8n, custom
//              integrations that connect over HTTP instead of spawning
//              a subprocess)
//
// Security layers:
//   1. WACRM_ENABLE_WRITES / WACRM_ENABLE_BROADCASTS / WACRM_ENABLE_WEBHOOKS
//      — tool groups not even registered unless explicitly enabled
//   2. WACRM_ALLOWED_SCOPES — optional explicit scope allowlist further
//      restricting visible tools beyond the env guards
//   3. WACRM_HTTP_AUTH_TOKEN — Bearer token required on HTTP connections
//   4. API key scopes enforced server-side by wacrm on every call
//
// Logs MUST go to stderr — stdout is the MCP protocol channel (stdio).
// ============================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig } from './config.js';
import { WacrmClient } from './client.js';
import { registerTools, type ScopeChecker } from './tools/index.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { logger } from './logger.js';

const VERSION = '1.0.0';
const SERVER_NAME = 'ansury-mcp';

function createMcpServer(
  client: WacrmClient,
  config: ReturnType<typeof loadConfig>,
  keyScopes: string[],
  canUse: ScopeChecker,
): { server: McpServer; groups: string[] } {
  const server = new McpServer({
    name: SERVER_NAME,
    version: VERSION,
  });

  const groups = registerTools(server, client, config, keyScopes);
  registerResources(server, client, canUse);
  registerPrompts(server);

  return { server, groups };
}

// ── HTTP/SSE transport ──────────────────────────────────────────────

/** Active SSE transports keyed by session id for proper cleanup. */
const sseTransports = new Map<string, SSEServerTransport>();

function startHttpServer(
  port: number,
  authToken: string | null,
  client: WacrmClient,
  config: ReturnType<typeof loadConfig>,
  keyScopes: string[],
  canUse: ScopeChecker,
): void {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // ── Auth check ───────────────────────────────────────────────
    if (authToken) {
      const auth = req.headers['authorization'] ?? '';
      const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (provided !== authToken) {
        logger.warn('http_auth_rejected', { ip: req.socket.remoteAddress, url: req.url });
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="Ansury MCP"',
        });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    logger.debug('http_request', { method: req.method, path: url.pathname });

    // ── Health / discovery ───────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          server: SERVER_NAME,
          version: VERSION,
          transport: 'sse',
          sse_endpoint: '/sse',
          active_sessions: sseTransports.size,
        }),
      );
      return;
    }

    // ── SSE endpoint (client → server via GET, opens event stream) ─
    if (req.method === 'GET' && url.pathname === '/sse') {
      const { server } = createMcpServer(client, config, keyScopes, canUse);
      const transport = new SSEServerTransport('/message', res);
      const sessionId = transport.sessionId;
      sseTransports.set(sessionId, transport);

      res.on('close', () => {
        sseTransports.delete(sessionId);
        logger.info('sse_session_closed', { sessionId, active: sseTransports.size });
      });

      await server.connect(transport);
      logger.info('sse_session_opened', { sessionId, active: sseTransports.size });
      return;
    }

    // ── Message endpoint (client → server POST for SSE sessions) ──
    if (req.method === 'POST' && url.pathname === '/message') {
      const sessionId = url.searchParams.get('sessionId') ?? '';
      const transport = sseTransports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No active session: ${sessionId}` }));
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    // ── 404 for everything else ──────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Not found',
        endpoints: { health: 'GET /health', sse: 'GET /sse', message: 'POST /message' },
      }),
    );
  });

  httpServer.listen(port, () => {
    logger.info('http_server_started', {
      port,
      auth: authToken ? 'bearer_token' : 'none',
      endpoints: {
        health: `http://localhost:${port}/health`,
        sse: `http://localhost:${port}/sse`,
        message: `http://localhost:${port}/message`,
      },
    });
  });

  httpServer.on('error', (err: Error) => {
    logger.error('http_server_error', { error: err.message });
    process.exit(1);
  });
}

// ── Main ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new WacrmClient(config);

  // Verify connectivity at startup (non-fatal — key might be valid
  // but the instance temporarily unreachable).
  let keyScopes: string[] = [];
  try {
    const me = await client.me();
    const data = (me as {
      data: { account?: { name?: string }; key?: { scopes?: string[] } };
    }).data;
    keyScopes = Array.isArray(data?.key?.scopes)
      ? data.key.scopes.filter((scope): scope is string => typeof scope === 'string')
      : [];
    logger.info('startup_verified', {
      account: data?.account?.name,
      scopes: keyScopes,
    });
  } catch (err) {
    logger.warn('startup_verify_failed', { error: (err as Error).message });
  }

  // ── HTTP/SSE transport (opt-in) ─────────────────────────────────
  const canUse: ScopeChecker = (required) =>
    config.scopeFilter.length === 0
      ? keyScopes.includes(required)
      : config.scopeFilter.includes(required) && keyScopes.includes(required);

  if (config.httpPort > 0) {
    startHttpServer(config.httpPort, config.httpAuthToken, client, config, keyScopes, canUse);
  }

  // ── Stdio transport (always on) ─────────────────────────────────
  const { server, groups } = createMcpServer(client, config, keyScopes, canUse);
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  logger.info('mcp_ready', {
    version: VERSION,
    instance: config.baseUrl,
    transport: config.httpPort > 0 ? 'stdio+sse' : 'stdio',
    toolGroups: groups,
    scopeFilter: config.scopeFilter.length ? config.scopeFilter : 'all',
    writes: config.enableWrites,
    broadcasts: config.enableBroadcasts,
    webhooks: config.enableWebhooks,
    keyScopes,
  });
}

main().catch((err) => {
  logger.error('startup_failed', { error: (err as Error).message });
  process.exit(1);
});

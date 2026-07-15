#!/usr/bin/env node
// ============================================================
// wacrm MCP Server entry point.
//
// Transports:
//   stdio - always on for Claude Desktop, Cursor, Claude Code, etc.
//   Streamable HTTP - opt-in via WACRM_HTTP_PORT for cloud/web agents.
//
// Logs MUST go to stderr. stdout is the MCP protocol channel for stdio.
// ============================================================

import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config.js';
import { WacrmClient } from './client.js';
import { registerTools, type ScopeChecker } from './tools/index.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';
import { logger } from './logger.js';

const VERSION = '1.0.0';
const SERVER_NAME = 'ansury-mcp';

type LoadedConfig = ReturnType<typeof loadConfig>;
type StreamableSession = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

const streamableSessions = new Map<string, StreamableSession>();

const JSON_RPC_ERROR_CODES = {
  invalidRequest: -32600,
  internal: -32603,
  badSession: -32000,
} as const;

function createMcpServer(
  client: WacrmClient,
  config: LoadedConfig,
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

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function writeJsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  writeJson(res, status, {
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

function writeCorsPreflight(res: ServerResponse): void {
  res.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Last-Event-ID, mcp-protocol-version, mcp-session-id',
    'Access-Control-Expose-Headers': 'mcp-protocol-version, mcp-session-id',
    'Access-Control-Max-Age': '86400',
  });
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  const limit = 1024 * 1024;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limit) {
      throw new Error('Request body exceeds 1 MB');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function closeStreamableSession(sessionId: string): Promise<void> {
  const session = streamableSessions.get(sessionId);
  if (!session) return;

  streamableSessions.delete(sessionId);
  await Promise.allSettled([session.transport.close(), session.server.close()]);
  logger.info('streamable_session_closed', {
    sessionId,
    active: streamableSessions.size,
  });
}

function startHttpServer(
  port: number,
  authToken: string | null,
  client: WacrmClient,
  config: LoadedConfig,
  keyScopes: string[],
  canUse: ScopeChecker,
): void {
  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);

      if (req.method === 'OPTIONS' && (url.pathname === '/mcp' || url.pathname === '/health')) {
        writeCorsPreflight(res);
        return;
      }

      if (authToken) {
        const auth = headerValue(req, 'authorization') ?? '';
        const provided = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        if (provided !== authToken) {
          logger.warn('http_auth_rejected', { ip: req.socket.remoteAddress, url: req.url });
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="wacrm MCP"',
          });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
      }

      logger.debug('http_request', { method: req.method, path: url.pathname });

      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, {
          status: 'ok',
          server: SERVER_NAME,
          version: VERSION,
          transport: 'streamable_http',
          mcp_endpoint: '/mcp',
          active_sessions: streamableSessions.size,
        });
        return;
      }

      if (url.pathname === '/sse' || url.pathname === '/message') {
        writeJson(res, 410, {
          error: 'Legacy SSE transport has been removed. Use the Streamable HTTP route at /mcp.',
          endpoint: '/mcp',
        });
        return;
      }

      if (url.pathname === '/mcp') {
        await handleMcpHttpRequest(req, res, client, config, keyScopes, canUse);
        return;
      }

      writeJson(res, 404, {
        error: 'Not found',
        endpoints: { health: 'GET /health', mcp: 'GET|POST|DELETE /mcp' },
      });
    } catch (err) {
      logger.error('http_request_failed', { error: (err as Error).message });
      if (!res.headersSent) {
        writeJsonRpcError(
          res,
          500,
          JSON_RPC_ERROR_CODES.internal,
          'Internal server error',
        );
      }
    }
  });

  httpServer.listen(port, () => {
    logger.info('http_server_started', {
      port,
      auth: authToken ? 'bearer_token' : 'none',
      endpoints: {
        health: `http://localhost:${port}/health`,
        mcp: `http://localhost:${port}/mcp`,
      },
    });
  });

  httpServer.on('error', (err: Error) => {
    logger.error('http_server_error', { error: err.message });
    process.exit(1);
  });
}

async function handleMcpHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  client: WacrmClient,
  config: LoadedConfig,
  keyScopes: string[],
  canUse: ScopeChecker,
): Promise<void> {
  const sessionId = headerValue(req, 'mcp-session-id');

  if (req.method === 'POST') {
    let parsedBody: unknown;
    try {
      parsedBody = await readJsonBody(req);
    } catch (err) {
      logger.warn('streamable_bad_json', { error: (err as Error).message });
      writeJsonRpcError(
        res,
        400,
        JSON_RPC_ERROR_CODES.invalidRequest,
        `Invalid JSON body: ${(err as Error).message}`,
      );
      return;
    }

    const existing = sessionId ? streamableSessions.get(sessionId) : undefined;
    if (existing) {
      await existing.transport.handleRequest(req, res, parsedBody);
      return;
    }

    if (sessionId) {
      writeJsonRpcError(
        res,
        404,
        JSON_RPC_ERROR_CODES.badSession,
        `No active MCP session: ${sessionId}`,
      );
      return;
    }

    if (!isInitializeRequest(parsedBody)) {
      writeJsonRpcError(
        res,
        400,
        JSON_RPC_ERROR_CODES.badSession,
        'Bad Request: initialize must be the first POST to /mcp, without an mcp-session-id header.',
      );
      return;
    }

    const { server } = createMcpServer(client, config, keyScopes, canUse);
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId) => {
        streamableSessions.set(newSessionId, { server, transport });
        logger.info('streamable_session_opened', {
          sessionId: newSessionId,
          active: streamableSessions.size,
        });
      },
      onsessionclosed: (closedSessionId) => {
        void closeStreamableSession(closedSessionId);
      },
    });

    transport.onerror = (err) => {
      logger.error('streamable_transport_error', { error: err.message });
    };
    transport.onclose = () => {
      const closedSessionId = transport.sessionId;
      if (closedSessionId) {
        streamableSessions.delete(closedSessionId);
      }
      void server.close().catch((err: Error) => {
        logger.warn('streamable_server_close_failed', { error: err.message });
      });
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
    return;
  }

  if (req.method === 'GET' || req.method === 'DELETE') {
    if (!sessionId) {
      writeJsonRpcError(
        res,
        400,
        JSON_RPC_ERROR_CODES.badSession,
        'Missing mcp-session-id header.',
      );
      return;
    }

    const session = streamableSessions.get(sessionId);
    if (!session) {
      writeJsonRpcError(
        res,
        404,
        JSON_RPC_ERROR_CODES.badSession,
        `No active MCP session: ${sessionId}`,
      );
      return;
    }

    await session.transport.handleRequest(req, res);
    return;
  }

  writeJsonRpcError(
    res,
    405,
    JSON_RPC_ERROR_CODES.badSession,
    'Method not allowed. Use GET, POST, or DELETE on /mcp.',
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new WacrmClient(config);

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

  const canUse: ScopeChecker = (required) =>
    config.scopeFilter.length === 0
      ? keyScopes.includes(required)
      : config.scopeFilter.includes(required) && keyScopes.includes(required);

  if (config.httpPort > 0) {
    startHttpServer(config.httpPort, config.httpAuthToken, client, config, keyScopes, canUse);
  }

  const { server, groups } = createMcpServer(client, config, keyScopes, canUse);
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);

  logger.info('mcp_ready', {
    version: VERSION,
    instance: config.baseUrl,
    transport: config.httpPort > 0 ? 'stdio+streamable_http' : 'stdio',
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

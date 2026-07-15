// ============================================================
// Shared helpers for tool handlers.
// ============================================================

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { WacrmApiError } from '../client.js';

export function jsonResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

/**
 * Wrap a tool handler — WacrmApiError → clean model-readable error;
 * unexpected throws don't crash the server.
 */
export function handle<A>(
  fn: (args: A) => Promise<CallToolResult>,
): (args: A) => Promise<CallToolResult> {
  return async (args: A) => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof WacrmApiError) {
        let msg = `wacrm API error [${err.code}] (HTTP ${err.status}): ${err.message}`;
        if (err.retryAfter) msg += `\nRetry after ${err.retryAfter}s.`;
        if (err.status === 403) {
          msg += `\nThis API key is missing the required scope. Check Settings → API keys.`;
        }
        return errorResult(msg);
      }
      return errorResult(`Unexpected error: ${(err as Error).message}`);
    }
  };
}

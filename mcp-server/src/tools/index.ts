// ============================================================
// Tool registration — scope-aware, with write/broadcast/webhook guards.
//
// Defence-in-depth:
//   1. Env guards (WACRM_ENABLE_WRITES etc.) — tool not registered at all.
//   2. WACRM_SCOPE_FILTER allowlist — further restricts visible tools.
//   3. The API key's own scopes are discovered by /me and used to filter tools.
//   4. The public API also enforces every scope on every actual call.
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import type { Config } from '../config.js';
import { registerReadTools } from './read.js';
import { registerWriteTools } from './write.js';
import { registerBroadcastTools } from './broadcast.js';
import { registerWebhookTools } from './webhooks.js';
import { logger } from '../logger.js';

export type ScopeChecker = (scope: string) => boolean;

function makeScopeChecker(keyScopes: string[], scopeFilter: string[]): ScopeChecker {
  return (required: string) => {
    const passesFilter = scopeFilter.length === 0 || scopeFilter.includes(required);
    return passesFilter && keyScopes.includes(required);
  };
}

export function registerTools(
  server: McpServer,
  client: WacrmClient,
  config: Config,
  keyScopes: string[],
): string[] {
  const enabled: string[] = [];
  const canUse = makeScopeChecker(keyScopes, config.scopeFilter);

  // Read tools are always registered, but some may still be skipped if the
  // API key lacks the required read scopes.
  registerReadTools(server, client, canUse);
  enabled.push('read');
  logger.info('tools_registered', { group: 'read' });

  if (config.enableWrites) {
    if (canUse('messages:send') || canUse('contacts:write')) {
      registerWriteTools(server, client, canUse);
      enabled.push('write');
      logger.info('tools_registered', { group: 'write' });
    } else {
      logger.warn('tools_skipped', {
        group: 'write',
        reason: 'missing required API scopes',
      });
    }
  }

  if (config.enableBroadcasts) {
    if (canUse('broadcasts:send')) {
      registerBroadcastTools(server, client);
      enabled.push('broadcast');
      logger.info('tools_registered', { group: 'broadcast' });
    } else {
      logger.warn('tools_skipped', {
        group: 'broadcast',
        reason: 'missing required API scopes',
      });
    }
  }

  if (config.enableWebhooks) {
    if (canUse('webhooks:manage')) {
      registerWebhookTools(server, client);
      enabled.push('webhooks');
      logger.info('tools_registered', { group: 'webhooks' });
    } else {
      logger.warn('tools_skipped', {
        group: 'webhooks',
        reason: 'missing required API scopes',
      });
    }
  }

  return enabled;
}

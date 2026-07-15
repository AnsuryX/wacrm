// ============================================================
// MCP Resources — expose CRM data as readable context.
//
// Resources are injected into the model's context window without
// a tool call, making them ideal for reference data an agent
// needs throughout a session (open conversations, contact details).
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from './client.js';
import { logger } from './logger.js';
import type { ScopeChecker } from './tools/index.js';

export function registerResources(
  server: McpServer,
  client: WacrmClient,
  canUse: ScopeChecker,
): void {
  // --- Open conversations list (refreshable) ----------------------
  if (canUse('conversations:read')) {
    server.registerResource(
    'open-conversations',
    'ansury://conversations/open',
    {
      title: 'Open conversations',
      description:
        'The 50 most recent open conversations in the CRM. Refresh to get the latest state. ' +
        'Includes contact name, phone, last message preview, unread count, and assigned agent.',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const result = await client.listConversations({ status: 'open', limit: 50 });
        return {
          contents: [
            {
              uri: 'ansury://conversations/open',
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.warn('resource_read_failed', { resource: 'open-conversations', error: (err as Error).message });
        return {
          contents: [
            {
              uri: 'ansury://conversations/open',
              mimeType: 'application/json',
              text: JSON.stringify({ error: (err as Error).message }),
            },
          ],
        };
      }
    },
  );
  } else {
    logger.warn('resource_skipped', {
      resource: 'open-conversations',
      reason: 'missing scope conversations:read',
    });
  }

  // --- Pending conversations list ---------------------------------
  if (canUse('conversations:read')) {
    server.registerResource(
    'pending-conversations',
    'ansury://conversations/pending',
    {
      title: 'Pending conversations',
      description:
        'The 50 most recent pending (awaiting action) conversations. ' +
        'Useful for triage — finding conversations that need attention.',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const result = await client.listConversations({ status: 'pending', limit: 50 });
        return {
          contents: [
            {
              uri: 'ansury://conversations/pending',
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.warn('resource_read_failed', { resource: 'pending-conversations', error: (err as Error).message });
        return {
          contents: [
            {
              uri: 'ansury://conversations/pending',
              mimeType: 'application/json',
              text: JSON.stringify({ error: (err as Error).message }),
            },
          ],
        };
      }
    },
  );
  } else {
    logger.warn('resource_skipped', {
      resource: 'pending-conversations',
      reason: 'missing scope conversations:read',
    });
  }

  // --- Recent contacts list ---------------------------------------
  if (canUse('contacts:read')) {
    server.registerResource(
    'recent-contacts',
    'ansury://contacts/recent',
    {
      title: 'Recent contacts',
      description:
        'The 50 most recently created contacts in the CRM. Useful for ' +
        'onboarding flows that operate on new leads.',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const result = await client.listContacts({ limit: 50 });
        return {
          contents: [
            {
              uri: 'ansury://contacts/recent',
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.warn('resource_read_failed', { resource: 'recent-contacts', error: (err as Error).message });
        return {
          contents: [
            {
              uri: 'ansury://contacts/recent',
              mimeType: 'application/json',
              text: JSON.stringify({ error: (err as Error).message }),
            },
          ],
        };
      }
    },
  );
  } else {
    logger.warn('resource_skipped', {
      resource: 'recent-contacts',
      reason: 'missing scope contacts:read',
    });
  }

  // --- Account identity -------------------------------------------
  server.registerResource(
    'account-info',
    'ansury://account',
    {
      title: 'Account info',
      description:
        'The account this API key is bound to, including name, id, and the ' +
        'scopes the key carries. Read this to understand what operations are allowed.',
      mimeType: 'application/json',
    },
    async () => {
      try {
        const result = await client.me();
        return {
          contents: [
            {
              uri: 'ansury://account',
              mimeType: 'application/json',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        logger.warn('resource_read_failed', { resource: 'account-info', error: (err as Error).message });
        return {
          contents: [
            {
              uri: 'ansury://account',
              mimeType: 'application/json',
              text: JSON.stringify({ error: (err as Error).message }),
            },
          ],
        };
      }
    },
  );
}

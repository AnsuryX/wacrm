// ============================================================
// MCP Resources - expose CRM data as readable context.
// ============================================================

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from './client.js';
import { logger } from './logger.js';
import type { ScopeChecker } from './tools/index.js';

type ConversationRow = Record<string, unknown>;

function resourceContents(uri: string, payload: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorContents(uri: string, err: unknown) {
  return resourceContents(uri, { error: (err as Error).message });
}

function isUnreadConversation(row: ConversationRow): boolean {
  const unread = row.unread_count ?? row.unreadCount;
  if (typeof unread === 'number') return unread > 0;
  if (typeof unread === 'string') return Number.parseInt(unread, 10) > 0;
  return false;
}

function conversationId(row: ConversationRow): string {
  const id = row.id;
  return typeof id === 'string' ? id : JSON.stringify(row);
}

async function listUnreadConversations(client: WacrmClient) {
  const [open, pending] = await Promise.all([
    client.listConversations({ status: 'open', limit: 50 }),
    client.listConversations({ status: 'pending', limit: 50 }),
  ]);

  const byId = new Map<string, ConversationRow>();
  for (const row of [...open.data, ...pending.data]) {
    if (row && typeof row === 'object' && isUnreadConversation(row as ConversationRow)) {
      const conversation = row as ConversationRow;
      byId.set(conversationId(conversation), conversation);
    }
  }

  return {
    data: [...byId.values()],
    meta: {
      source_statuses: ['open', 'pending'],
      limit_per_status: 50,
      count: byId.size,
      refreshed_at: new Date().toISOString(),
    },
  };
}

export function registerResources(
  server: McpServer,
  client: WacrmClient,
  canUse: ScopeChecker,
): void {
  if (canUse('conversations:read')) {
    server.registerResource(
      'unread-chats',
      'wacrm://chats/unread',
      {
        title: 'Unread chats',
        description:
          'Unread open and pending chats, refreshed from the CRM. Use this for active inbox context.',
        mimeType: 'application/json',
      },
      async () => {
        try {
          return resourceContents('wacrm://chats/unread', await listUnreadConversations(client));
        } catch (err) {
          logger.warn('resource_read_failed', {
            resource: 'unread-chats',
            error: (err as Error).message,
          });
          return errorContents('wacrm://chats/unread', err);
        }
      },
    );

    server.registerResource(
      'open-conversations',
      'ansury://conversations/open',
      {
        title: 'Open conversations',
        description:
          'The 50 most recent open conversations in the CRM. Refresh to get the latest state. Includes contact name, phone, last message preview, unread count, and assigned agent.',
        mimeType: 'application/json',
      },
      async () => {
        try {
          return resourceContents(
            'ansury://conversations/open',
            await client.listConversations({ status: 'open', limit: 50 }),
          );
        } catch (err) {
          logger.warn('resource_read_failed', {
            resource: 'open-conversations',
            error: (err as Error).message,
          });
          return errorContents('ansury://conversations/open', err);
        }
      },
    );

    server.registerResource(
      'pending-conversations',
      'ansury://conversations/pending',
      {
        title: 'Pending conversations',
        description:
          'The 50 most recent pending conversations. Useful for triage and finding chats that need attention.',
        mimeType: 'application/json',
      },
      async () => {
        try {
          return resourceContents(
            'ansury://conversations/pending',
            await client.listConversations({ status: 'pending', limit: 50 }),
          );
        } catch (err) {
          logger.warn('resource_read_failed', {
            resource: 'pending-conversations',
            error: (err as Error).message,
          });
          return errorContents('ansury://conversations/pending', err);
        }
      },
    );
  } else {
    logger.warn('resource_skipped', {
      resource: 'conversation resources',
      reason: 'missing scope conversations:read',
    });
  }

  if (canUse('contacts:read')) {
    server.registerResource(
      'recent-contacts',
      'ansury://contacts/recent',
      {
        title: 'Recent contacts',
        description:
          'The 50 most recently created contacts in the CRM. Useful for onboarding flows that operate on new leads.',
        mimeType: 'application/json',
      },
      async () => {
        try {
          return resourceContents(
            'ansury://contacts/recent',
            await client.listContacts({ limit: 50 }),
          );
        } catch (err) {
          logger.warn('resource_read_failed', {
            resource: 'recent-contacts',
            error: (err as Error).message,
          });
          return errorContents('ansury://contacts/recent', err);
        }
      },
    );
  } else {
    logger.warn('resource_skipped', {
      resource: 'recent-contacts',
      reason: 'missing scope contacts:read',
    });
  }

  server.registerResource(
    'account-info',
    'ansury://account',
    {
      title: 'Account info',
      description:
        'The account this API key is bound to, including name, id, and the scopes the key carries.',
      mimeType: 'application/json',
    },
    async () => {
      try {
        return resourceContents('ansury://account', await client.me());
      } catch (err) {
        logger.warn('resource_read_failed', {
          resource: 'account-info',
          error: (err as Error).message,
        });
        return errorContents('ansury://account', err);
      }
    },
  );
}

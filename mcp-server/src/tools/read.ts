// ============================================================
// Read-only tools — always registered (subject to scope filter).
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { handle, jsonResult } from './shared.js';
import { logger } from '../logger.js';
import type { ScopeChecker } from './index.js';

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

export function registerReadTools(
  server: McpServer,
  client: WacrmClient,
  canUse: ScopeChecker,
): void {
  // ---- Identity --------------------------------------------------
  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Verify the API key and show which Ansury Systems account it is bound to, ' +
        'what scopes it carries, and whether writes/broadcasts are enabled. ' +
        'Call this first to discover what actions are available.',
      inputSchema: {},
      annotations: { ...READ_ONLY, title: 'Who am I' },
    },
    handle(async () => jsonResult(await client.me())),
  );

  // ---- Contacts --------------------------------------------------
  if (canUse('contacts:read')) {
    server.registerTool(
      'list_contacts',
      {
        title: 'List contacts',
        description:
          'List contacts in the CRM, newest first. Optionally filter by free-text ' +
          'search (name or phone) or by tag id. Paginated — pass next_cursor to continue.',
        inputSchema: {
          search: z.string().optional().describe('Free-text search over name or phone.'),
          tag: z.string().optional().describe('Tag id to filter by.'),
          limit: z.number().int().min(1).max(100).optional().describe('Page size 1–100 (default 50).'),
          cursor: z.string().optional().describe('Opaque cursor from a previous response.'),
        },
        annotations: { ...READ_ONLY, title: 'List contacts' },
      },
      handle(async (args) => jsonResult(await client.listContacts(args))),
    );

    server.registerTool(
      'get_contact',
      {
        title: 'Get contact',
        description: 'Read a single contact by id, including tags and custom fields.',
        inputSchema: { id: z.string().describe('Contact UUID.') },
        annotations: { ...READ_ONLY, title: 'Get contact' },
      },
      handle(async ({ id }) => jsonResult(await client.getContact(id))),
    );
  } else {
    logger.warn('tool_skipped', { tool: 'list_contacts/get_contact', reason: 'missing scope contacts:read' });
  }

  // ---- Conversations ---------------------------------------------
  if (canUse('conversations:read')) {
    server.registerTool(
      'list_conversations',
      {
        title: 'List conversations',
        description:
          'List conversations, newest first. Filter by status or contact. Paginated.',
        inputSchema: {
          status: z
            .enum(['open', 'pending', 'closed'])
            .optional()
            .describe('Filter by conversation status.'),
          contact_id: z.string().optional().describe('Only conversations for this contact UUID.'),
          limit: z.number().int().min(1).max(100).optional().describe('Page size 1–100 (default 50).'),
          cursor: z.string().optional().describe('Pagination cursor.'),
        },
        annotations: { ...READ_ONLY, title: 'List conversations' },
      },
      handle(async (args) => jsonResult(await client.listConversations(args))),
    );

    server.registerTool(
      'get_conversation',
      {
        title: 'Get conversation',
        description: 'Read a single conversation by id, including contact and tags.',
        inputSchema: { id: z.string().describe('Conversation UUID.') },
        annotations: { ...READ_ONLY, title: 'Get conversation' },
      },
      handle(async ({ id }) => jsonResult(await client.getConversation(id))),
    );
  } else {
    logger.warn('tool_skipped', { tool: 'list_conversations/get_conversation', reason: 'missing scope conversations:read' });
  }

  if (canUse('messages:read')) {
    server.registerTool(
      'list_messages',
      {
        title: 'List messages',
        description:
          'List messages in a conversation, newest first. Includes direction ' +
          '(inbound/outbound), delivery status, content type, and text. Paginated.',
        inputSchema: {
          conversation_id: z.string().describe('Conversation UUID to read messages from.'),
          limit: z.number().int().min(1).max(100).optional().describe('Page size 1–100 (default 50).'),
          cursor: z.string().optional().describe('Pagination cursor.'),
        },
        annotations: { ...READ_ONLY, title: 'List messages' },
      },
      handle(async ({ conversation_id, limit, cursor }) =>
        jsonResult(await client.listConversationMessages(conversation_id, { limit, cursor })),
      ),
    );
  } else {
    logger.warn('tool_skipped', { tool: 'list_messages', reason: 'missing scope messages:read' });
  }

  // ---- Broadcasts ------------------------------------------------
  if (canUse('broadcasts:send')) {
    server.registerTool(
      'list_broadcasts',
      {
        title: 'List broadcasts',
        description: 'List broadcast campaigns, newest first. Paginated.',
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional().describe('Page size 1–100 (default 50).'),
          cursor: z.string().optional().describe('Pagination cursor.'),
        },
        annotations: { ...READ_ONLY, title: 'List broadcasts' },
      },
      handle(async (args) => jsonResult(await client.listBroadcasts(args))),
    );

    server.registerTool(
      'get_broadcast',
      {
        title: 'Get broadcast status',
        description:
          'Read a broadcast campaign by id — status, delivered/read/rejected counts. ' +
          'Poll this after launching a broadcast to track progress.',
        inputSchema: { id: z.string().describe('Broadcast UUID.') },
        annotations: { ...READ_ONLY, title: 'Get broadcast status' },
      },
      handle(async ({ id }) => jsonResult(await client.getBroadcast(id))),
    );
  } else {
    logger.warn('tool_skipped', { tool: 'list_broadcasts/get_broadcast', reason: 'missing scope broadcasts:send' });
  }
}

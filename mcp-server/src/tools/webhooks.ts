// ============================================================
// Webhook management tools — registered when WACRM_ENABLE_WEBHOOKS=true.
// Scope: webhooks:manage
//
// Lets AI agents register endpoints to receive real-time events
// (message.received, conversation.created, message.status_updated)
// from the Ansury Systems CRM without polling.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { errorResult, handle, jsonResult } from './shared.js';

const VALID_EVENTS = ['message.received', 'message.status_updated', 'conversation.created'] as const;

export function registerWebhookTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'list_webhooks',
    {
      title: 'List webhook endpoints',
      description:
        'List all registered outbound webhook endpoints for this account. ' +
        'Shows URL, subscribed events, active status, and failure count. ' +
        'The signing secret is never returned after creation.',
      inputSchema: {},
      annotations: { readOnlyHint: true, title: 'List webhook endpoints' },
    },
    handle(async () => jsonResult(await client.listWebhooks())),
  );

  server.registerTool(
    'get_webhook',
    {
      title: 'Get webhook endpoint',
      description: 'Read a single webhook endpoint by id.',
      inputSchema: { id: z.string().describe('Webhook endpoint UUID.') },
      annotations: { readOnlyHint: true, title: 'Get webhook endpoint' },
    },
    handle(async ({ id }) => jsonResult(await client.getWebhook(id))),
  );

  server.registerTool(
    'create_webhook',
    {
      title: 'Create webhook endpoint',
      description:
        'Register an HTTPS endpoint to receive CRM events in real time. ' +
        'The response includes the signing secret EXACTLY ONCE — store it ' +
        'immediately to verify X-Wacrm-Signature on deliveries. ' +
        'Verify signatures: HMAC-SHA256(secret, "${t}.${rawBody}") where t ' +
        'comes from the X-Wacrm-Signature header.',
      inputSchema: {
        url: z
          .string()
          .url()
          .refine((u) => u.startsWith('https://'), 'URL must be HTTPS.')
          .describe('Public HTTPS endpoint to POST events to.'),
        events: z
          .array(z.enum(VALID_EVENTS))
          .min(1)
          .describe(
            'Events to subscribe to: message.received | message.status_updated | conversation.created',
          ),
      },
      annotations: { readOnlyHint: false, title: 'Create webhook endpoint' },
    },
    handle(async (args) => {
      const result = await client.createWebhook(args);
      // Surface the one-time secret prominently.
      const data = (result as { data: Record<string, unknown> }).data;
      if (data?.secret) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                `Webhook created successfully.\n\n` +
                `⚠️  SAVE THIS SECRET NOW — it will never be shown again:\n\n` +
                `  Signing secret: ${data.secret}\n\n` +
                `Use it to verify X-Wacrm-Signature on deliveries:\n` +
                `  HMAC-SHA256(secret, \`\${t}.\${rawBody}\`)\n\n` +
                `Full response:\n${JSON.stringify(result, null, 2)}`,
            },
          ],
        };
      }
      return jsonResult(result);
    }),
  );

  server.registerTool(
    'update_webhook',
    {
      title: 'Update webhook endpoint',
      description:
        'Update a webhook endpoint\'s URL, subscribed events, or active status. ' +
        'Re-enabling (is_active: true) also resets the failure counter.',
      inputSchema: {
        id: z.string().describe('Webhook endpoint UUID.'),
        url: z
          .string()
          .url()
          .refine((u) => u.startsWith('https://'), 'URL must be HTTPS.')
          .optional()
          .describe('New HTTPS URL.'),
        events: z.array(z.enum(VALID_EVENTS)).min(1).optional().describe('New event list.'),
        is_active: z.boolean().optional().describe('Enable or disable the endpoint.'),
      },
      annotations: { readOnlyHint: false, title: 'Update webhook endpoint' },
    },
    handle(async ({ id, ...body }) => jsonResult(await client.updateWebhook(id, body))),
  );

  server.registerTool(
    'delete_webhook',
    {
      title: 'Delete webhook endpoint',
      description:
        'Permanently remove a webhook endpoint. Events will stop being delivered immediately.',
      inputSchema: {
        id: z.string().describe('Webhook endpoint UUID.'),
        confirm: z.boolean().describe('Must be true to proceed.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, title: 'Delete webhook endpoint' },
    },
    handle(async ({ id, confirm }) => {
      if (confirm !== true) {
        return errorResult('Refusing to delete: set confirm=true to remove this webhook endpoint.');
      }
      return jsonResult(await client.deleteWebhook(id));
    }),
  );
}

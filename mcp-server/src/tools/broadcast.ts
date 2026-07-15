// ============================================================
// Broadcast tool - highest-risk action.
// Requires WACRM_ENABLE_WRITES + WACRM_ENABLE_BROADCASTS.
// Also requires explicit confirm=true at call time.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { errorResult, handle, jsonResult } from './shared.js';

const broadcastAttachmentSchema = z.object({
  type: z.enum(['image', 'video', 'document', 'audio']),
  url: z.string().url().optional(),
  mediaUrl: z.string().url().optional(),
  media_url: z.string().url().optional(),
  filename: z.string().optional(),
  caption: z.string().optional(),
});

type BroadcastArgs = {
  name: string;
  template_name: string;
  template_language: string;
  recipients: unknown[];
  confirm: boolean;
  mediaUrl?: string;
  media_url?: string;
  attachments?: unknown[];
};

export function registerBroadcastTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'send_broadcast',
    {
      title: 'Send broadcast',
      description:
        'Launch a WhatsApp template broadcast to up to 1000 recipients. ' +
        'This sends a REAL message to every recipient in the list - a mass, ' +
        'irreversible action. You MUST set confirm=true and show the full ' +
        'recipient list and template to the user for explicit approval first. ' +
        'The public broadcast API is template-only; mediaUrl/attachments are accepted ' +
        'for schema compatibility but rejected unless the backend adds media broadcast support.',
      inputSchema: {
        name: z.string().describe('Campaign name (internal reference).'),
        template_name: z.string().describe('Meta-approved template name.'),
        template_language: z.string().describe('Template language code, e.g. "en_US".'),
        recipients: z
          .array(
            z.object({
              to: z.string().describe('Recipient phone in E.164 format.'),
              params: z
                .array(z.string())
                .optional()
                .describe('Positional body variables for this recipient.'),
            }),
          )
          .min(1)
          .max(1000)
          .describe('Recipients (1-1000). Invalid numbers are dropped and counted as rejected.'),
        media_url: z
          .string()
          .url()
          .optional()
          .describe('Reserved for future media broadcast support; currently rejected.'),
        mediaUrl: z
          .string()
          .url()
          .optional()
          .describe('Camel-case alias for media_url; currently rejected for broadcasts.'),
        attachments: z
          .array(broadcastAttachmentSchema)
          .optional()
          .describe('Reserved for future media broadcast support; currently rejected.'),
        confirm: z
          .boolean()
          .describe(
            'MUST be true to send. This is a safety gate - the model must ' +
              'consciously set this after the user approves the send.',
          ),
      },
      annotations: {
        title: 'Send broadcast',
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    handle(async ({ confirm, ...body }) => {
      const broadcast = body as Omit<BroadcastArgs, 'confirm'>;
      if (confirm !== true) {
        return errorResult(
          `Refusing to send: confirm must be true.\n` +
            `This will broadcast to ${broadcast.recipients.length} recipient(s).\n` +
            `Show the recipient list and template to the user, get explicit approval, then call again with confirm=true.`,
        );
      }

      if (broadcast.media_url || broadcast.mediaUrl || broadcast.attachments?.length) {
        return errorResult(
          'Refusing to send media broadcast: the public broadcast API is currently template-only. ' +
            'Use an approved WhatsApp media-header template if available, or send media with send_message to individual recipients.',
        );
      }

      return jsonResult(await client.sendBroadcast(broadcast));
    }),
  );
}

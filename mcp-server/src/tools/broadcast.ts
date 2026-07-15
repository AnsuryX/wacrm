// ============================================================
// Broadcast tool — highest-risk action.
// Requires WACRM_ENABLE_WRITES + WACRM_ENABLE_BROADCASTS.
// Also requires explicit confirm=true at call time.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import { errorResult, handle, jsonResult } from './shared.js';

export function registerBroadcastTools(server: McpServer, client: WacrmClient): void {
  server.registerTool(
    'send_broadcast',
    {
      title: 'Send broadcast',
      description:
        'Launch a WhatsApp template broadcast to up to 1000 recipients. ' +
        'This sends a REAL message to every recipient in the list — a mass, ' +
        'irreversible action. You MUST set confirm=true and show the full ' +
        'recipient list and template to the user for explicit approval first. ' +
        'The call returns fast; use get_broadcast to poll delivery progress.',
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
          .describe('Recipients (1–1000). Invalid numbers are dropped and counted as rejected.'),
        confirm: z
          .boolean()
          .describe(
            'MUST be true to send. This is a safety gate — the model must ' +
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
      if (confirm !== true) {
        return errorResult(
          `Refusing to send: confirm must be true.\n` +
            `This will broadcast to ${(body as { recipients: unknown[] }).recipients.length} recipient(s).\n` +
            `Show the recipient list and template to the user, get explicit approval, then call again with confirm=true.`,
        );
      }
      return jsonResult(await client.sendBroadcast(body));
    }),
  );
}

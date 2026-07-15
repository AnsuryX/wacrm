// ============================================================
// Write tools - registered only when WACRM_ENABLE_WRITES=true.
// These mutate data or send real WhatsApp messages.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WacrmClient } from '../client.js';
import type { ScopeChecker } from './index.js';
import { handle, jsonResult } from './shared.js';
import { logger } from '../logger.js';

const WRITE = { readOnlyHint: false, openWorldHint: true } as const;

const mediaTypeSchema = z.enum(['image', 'video', 'document', 'audio']);

const templateSchema = z
  .object({
    name: z.string().describe('Meta-approved template name.'),
    language: z.string().describe('Template language code, e.g. "en_US".'),
    params: z.array(z.string()).optional().describe('Positional body variables, in order.'),
  })
  .describe('Template payload - required when type is "template".');

const attachmentSchema = z.object({
  type: mediaTypeSchema.describe('WhatsApp media type for this attachment.'),
  url: z.string().url().optional().describe('Public HTTPS URL of the media file.'),
  mediaUrl: z.string().url().optional().describe('Camel-case alias for url.'),
  media_url: z.string().url().optional().describe('Snake-case alias for url.'),
  filename: z.string().optional().describe('Filename shown for documents.'),
  caption: z.string().optional().describe('Caption for image, video, or document media.'),
});

type SendMessageArgs = {
  to: string;
  type?: 'text' | 'template' | 'image' | 'video' | 'document' | 'audio';
  text?: string;
  media_url?: string;
  mediaUrl?: string;
  filename?: string;
  template?: unknown;
  reply_to_message_id?: string;
  attachments?: Array<{
    type: 'image' | 'video' | 'document' | 'audio';
    url?: string;
    mediaUrl?: string;
    media_url?: string;
    filename?: string;
    caption?: string;
  }>;
};

function normalizeSingleMessage(args: SendMessageArgs): Record<string, unknown> {
  const { mediaUrl, attachments: _attachments, ...body } = args;
  return {
    ...body,
    media_url: args.media_url ?? mediaUrl,
  };
}

async function sendMessageWithAttachments(client: WacrmClient, args: SendMessageArgs) {
  if (!args.attachments?.length) {
    return client.sendMessage(normalizeSingleMessage(args));
  }

  if (args.type === 'template') {
    throw new Error('attachments cannot be combined with template messages.');
  }

  const results: unknown[] = [];
  const text = args.text?.trim();

  if ((args.type ?? 'text') === 'text' && text && args.attachments.length > 1) {
    results.push(
      await client.sendMessage({
        to: args.to,
        type: 'text',
        text,
        reply_to_message_id: args.reply_to_message_id,
      }),
    );
  }

  for (const [index, attachment] of args.attachments.entries()) {
    const mediaUrl = attachment.media_url ?? attachment.mediaUrl ?? attachment.url;
    if (!mediaUrl) {
      throw new Error(`attachments[${index}] requires url, mediaUrl, or media_url.`);
    }

    results.push(
      await client.sendMessage({
        to: args.to,
        type: attachment.type,
        text: attachment.caption ?? (args.attachments.length === 1 ? args.text : undefined),
        media_url: mediaUrl,
        filename: attachment.filename ?? args.filename,
        reply_to_message_id: index === 0 ? args.reply_to_message_id : undefined,
      }),
    );
  }

  return {
    data: {
      sent_count: results.length,
      messages: results,
    },
  };
}

export function registerWriteTools(
  server: McpServer,
  client: WacrmClient,
  canUse: ScopeChecker,
): void {
  // ---- Messages --------------------------------------------------
  if (canUse('messages:send')) {
    server.registerTool(
      'send_message',
      {
        title: 'Send WhatsApp message',
        description:
          'Send a WhatsApp message to a phone number (E.164, e.g. +14155550123). ' +
          'The contact and conversation are found-or-created automatically. ' +
          'Use type "text" for free-form text, "template" to open or re-engage a conversation, ' +
          'or a media type for files. Media can be passed as media_url, mediaUrl, or attachments. ' +
          'IMPORTANT: this sends a real message to a real person - confirm recipient ' +
          'and content with the user before calling.',
        inputSchema: {
          to: z.string().describe('Recipient phone in E.164 format, e.g. +14155550123.'),
          type: z
            .enum(['text', 'template', 'image', 'video', 'document', 'audio'])
            .default('text')
            .describe('Message type.'),
          text: z.string().optional().describe('Body for "text", or caption for media.'),
          media_url: z
            .string()
            .url()
            .optional()
            .describe('Public HTTPS URL of the media file (required for media types).'),
          mediaUrl: z.string().url().optional().describe('Camel-case alias for media_url.'),
          filename: z.string().optional().describe('Filename shown for documents.'),
          attachments: z
            .array(attachmentSchema)
            .optional()
            .describe(
              'Optional media attachments. One attachment is sent as one media message; multiple attachments are sent as separate WhatsApp messages.',
            ),
          template: templateSchema.optional(),
          reply_to_message_id: z
            .string()
            .optional()
            .describe('UUID of a message to quote-reply to.'),
        },
        annotations: { ...WRITE, title: 'Send WhatsApp message' },
      },
      handle(async (args) =>
        jsonResult(await sendMessageWithAttachments(client, args as SendMessageArgs)),
      ),
    );
  } else {
    logger.warn('tool_skipped', { tool: 'send_message', reason: 'missing scope messages:send' });
  }

  // ---- Contacts --------------------------------------------------
  if (canUse('contacts:write')) {
    server.registerTool(
      'create_contact',
      {
        title: 'Create contact',
        description:
          'Create a contact by phone number (E.164, required). Find-or-create: ' +
          'an existing number is returned unchanged (HTTP 200); new = HTTP 201. ' +
          'Optional: name, email, company, tags (tag names; created if missing).',
        inputSchema: {
          phone: z.string().describe('Phone in E.164 format.'),
          name: z.string().optional(),
          email: z.string().email().optional(),
          company: z.string().optional(),
          tags: z.array(z.string()).optional().describe('Tag names; auto-created if absent.'),
        },
        annotations: { ...WRITE, title: 'Create contact' },
      },
      handle(async (args) => jsonResult(await client.createContact(args))),
    );

    server.registerTool(
      'update_contact',
      {
        title: 'Update contact',
        description:
          'Patch an existing contact. Only supplied fields are changed. ' +
          "Pass tags (array of names) to completely replace the contact's tag set.",
        inputSchema: {
          id: z.string().describe('Contact UUID.'),
          name: z.string().optional(),
          email: z.string().email().optional(),
          company: z.string().optional(),
          tags: z.array(z.string()).optional().describe('Replaces all existing tags.'),
        },
        annotations: { ...WRITE, title: 'Update contact' },
      },
      handle(async ({ id, ...body }) => jsonResult(await client.updateContact(id, body))),
    );

    server.registerTool(
      'delete_contact',
      {
        title: 'Delete contact',
        description:
          'Permanently delete a contact and all their conversations. ' +
          'IRREVERSIBLE - confirm with the user before calling.',
        inputSchema: {
          id: z.string().describe('Contact UUID to delete.'),
          confirm: z
            .boolean()
            .describe('Must be true to proceed. Safety gate for an irreversible action.'),
        },
        annotations: {
          ...WRITE,
          destructiveHint: true,
          title: 'Delete contact',
        },
      },
      handle(async ({ id, confirm }) => {
        if (confirm !== true) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Refusing to delete: confirm must be true. This permanently removes the contact and all their conversations.',
              },
            ],
            isError: true,
          };
        }
        return jsonResult(await client.deleteContact(id));
      }),
    );
  } else {
    logger.warn('tool_skipped', {
      tool: 'create_contact/update_contact/delete_contact',
      reason: 'missing scope contacts:write',
    });
  }
}

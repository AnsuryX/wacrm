// ============================================================
// MCP Prompts — pre-built task templates for common CRM workflows.
//
// Prompts are reusable instruction sets that agents or users can
// invoke by name, optionally with arguments. They return a message
// array that the MCP client injects as the conversation start.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerPrompts(server: McpServer): void {
  // --- Inbox triage -----------------------------------------------
  server.registerPrompt(
    'triage-inbox',
    {
      title: 'Triage inbox',
      description:
        'Summarise the current open and pending conversations, identify which ' +
        'need urgent attention, and suggest next actions for each.',
      argsSchema: {
        max_conversations: z
          .string()
          .optional()
          .describe('Maximum conversations to review (default 20).'),
      },
    },
    ({ max_conversations }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `You are a CRM assistant for Ansury Systems. ` +
              `Please triage the inbox by doing the following:\n\n` +
              `1. Call list_conversations with status="open" (limit ${max_conversations ?? 20})\n` +
              `2. Call list_conversations with status="pending" (limit ${max_conversations ?? 20})\n` +
              `3. For each conversation, note: contact name, last message preview, how long since last reply, unread count\n` +
              `4. Sort by urgency (longest waiting first)\n` +
              `5. Present a concise triage summary with recommended next actions\n\n` +
              `Be brief and actionable. Flag anything that looks like an unhappy customer.`,
          },
        },
      ],
    }),
  );

  // --- Contact lookup & summary -----------------------------------
  server.registerPrompt(
    'contact-summary',
    {
      title: 'Contact summary',
      description:
        'Look up a contact by phone number or name and produce a full summary ' +
        'including their recent conversation history.',
      argsSchema: {
        query: z.string().describe('Phone number (E.164) or name to search for.'),
      },
    },
    ({ query }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `You are a CRM assistant for Ansury Systems. ` +
              `Please look up the contact "${query}" and provide a full summary:\n\n` +
              `1. Call list_contacts with search="${query}" to find them\n` +
              `2. If found, call get_contact with their id for full details\n` +
              `3. Call list_conversations with their contact_id to find their conversations\n` +
              `4. For the most recent open or pending conversation, call list_messages to see the thread\n` +
              `5. Summarise: contact details, tags, how long they've been a customer, ` +
              `recent conversation topics, last interaction date, and current status\n\n` +
              `If not found, say so clearly and suggest creating them.`,
          },
        },
      ],
    }),
  );

  // --- Draft reply ------------------------------------------------
  server.registerPrompt(
    'draft-reply',
    {
      title: 'Draft a reply',
      description:
        'Read a conversation and draft an appropriate WhatsApp reply based on context.',
      argsSchema: {
        conversation_id: z.string().describe('Conversation UUID to draft a reply for.'),
        tone: z
          .string()
          .optional()
          .describe('Desired tone: professional, friendly, empathetic, etc.'),
        instructions: z.string().optional().describe('Additional instructions for the reply.'),
      },
    },
    ({ conversation_id, tone, instructions }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `You are a CRM assistant for Ansury Systems. ` +
              `Draft a WhatsApp reply for conversation ${conversation_id}:\n\n` +
              `1. Call get_conversation with id="${conversation_id}"\n` +
              `2. Call list_messages with conversation_id="${conversation_id}" (limit 20) to read the thread\n` +
              `3. Draft a reply that:\n` +
              `   - Directly addresses the customer's most recent message\n` +
              `   - Matches the tone: ${tone ?? 'professional and friendly'}\n` +
              `   ${instructions ? `- Additional: ${instructions}\n` : ''}` +
              `   - Is concise (WhatsApp messages should be brief)\n` +
              `   - Does NOT send automatically — present the draft for review first\n\n` +
              `Show the draft clearly and ask for approval before using send_message.`,
          },
        },
      ],
    }),
  );

  // --- Broadcast planner ------------------------------------------
  server.registerPrompt(
    'plan-broadcast',
    {
      title: 'Plan a broadcast',
      description:
        'Help plan and review a broadcast campaign before launching it. ' +
        'Lists available contacts and guides through recipient selection.',
      argsSchema: {
        template_name: z.string().describe('Name of the WhatsApp template to use.'),
        tag: z.string().optional().describe('Optional tag name to filter recipients by.'),
      },
    },
    ({ template_name, tag }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text:
              `You are a CRM assistant for Ansury Systems helping plan a broadcast.\n\n` +
              `Template: "${template_name}"\n` +
              `${tag ? `Target tag: "${tag}"\n` : 'No tag filter — targeting all contacts.\n'}` +
              `\nPlease:\n` +
              `1. Call list_contacts${tag ? ` with tag="${tag}"` : ''} to see who will be targeted\n` +
              `2. Show a preview of the recipient list (name + phone)\n` +
              `3. Show the total count\n` +
              `4. Remind me that this sends a REAL WhatsApp message to all recipients\n` +
              `5. Ask for explicit confirmation before proceeding\n` +
              `6. Only call send_broadcast after I confirm, with confirm=true\n\n` +
              `Do NOT send anything without my explicit "yes, send it" approval.`,
          },
        },
      ],
    }),
  );

  // --- Webhook setup guide ----------------------------------------
  server.registerPrompt(
    'setup-webhook',
    {
      title: 'Set up a webhook',
      description:
        'Guide through registering a webhook endpoint and verifying the signing secret.',
      argsSchema: {
        url: z.string().describe('The HTTPS URL that should receive events.'),
        events: z
          .string()
          .optional()
          .describe(
            'Comma-separated events: message.received, message.status_updated, conversation.created',
          ),
      },
    },
    ({ url, events }) => {
      const eventList = events
        ? events.split(',').map((e) => e.trim())
        : ['message.received', 'conversation.created'];
      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text:
                `You are a CRM assistant for Ansury Systems. ` +
                `Please set up a webhook endpoint:\n\n` +
                `URL: ${url}\n` +
                `Events: ${eventList.join(', ')}\n\n` +
                `Steps:\n` +
                `1. Call create_webhook with url="${url}" and events=${JSON.stringify(eventList)}\n` +
                `2. The response will include a signing secret — show it prominently\n` +
                `3. Explain how to verify the X-Wacrm-Signature header:\n` +
                `   HMAC-SHA256(secret, \`\${t}.\${rawBody}\`)\n` +
                `   where t comes from the header value t=<unix_seconds>,v1=<hex>\n` +
                `4. Warn that the secret is shown ONLY ONCE and must be saved now\n` +
                `5. Confirm the endpoint is active with list_webhooks`,
            },
          },
        ],
      };
    },
  );
}

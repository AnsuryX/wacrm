import type { SupabaseClient } from '@supabase/supabase-js';
import type { Deal, Property, Booking } from '@/types';
import { dispatchWebhookEvent } from '../webhooks/deliver';

export interface ToolExecutionResult {
  success: boolean;
  tool: string;
  data?: any;
  error?: string;
}

/**
 * Executes a tool chosen by the AI Agent against secure backend API / DB logic,
 * triggering real-time UI updates via standard Supabase table inserts/updates.
 */
export async function executeAgentTool(
  supabase: SupabaseClient,
  accountId: string,
  toolName: string,
  args: any
): Promise<ToolExecutionResult> {
  console.log(`[AgentExecutor] Executing tool '${toolName}' for account '${accountId}' with args:`, args);

  try {
    switch (toolName) {
      case 'create_deal': {
        const { contact_id, title, value, property_id, notes } = args;
        if (!contact_id || !title) {
          return { success: false, tool: toolName, error: 'contact_id and title are required' };
        }

        // Fetch account pipeline to assign
        const { data: pipeline } = await supabase
          .from('pipelines')
          .select('id')
          .eq('account_id', accountId)
          .limit(1)
          .maybeSingle();

        if (!pipeline) {
          return { success: false, tool: toolName, error: 'No pipeline found for this account' };
        }

        // Fetch 'New Lead' stage
        const { data: stage } = await supabase
          .from('pipeline_stages')
          .select('id')
          .eq('pipeline_id', pipeline.id)
          .eq('name', 'New Lead')
          .maybeSingle();

        if (!stage) {
          return { success: false, tool: toolName, error: 'New Lead stage not found' };
        }

        const { data: deal, error } = await supabase
          .from('deals')
          .insert({
            account_id: accountId,
            user_id: args.user_id || (await resolveDefaultUser(supabase, accountId)),
            pipeline_id: pipeline.id,
            stage_id: stage.id,
            contact_id,
            property_id: property_id || null,
            title,
            value: value || 0,
            notes: notes || '',
            stage: 'New Lead',
          })
          .select('*')
          .single();

        if (error) throw error;

        // Dispatch outbound webhook for n8n/external systems
        dispatchWebhookEvent(supabase, accountId, 'deal.stage_updated', deal)
          .catch((err) => console.error('[AgentExecutor] Webhook dispatch error for deal.stage_updated:', err));

        return { success: true, tool: toolName, data: deal };
      }

      case 'update_deal_stage': {
        const { deal_id, stage } = args;
        if (!deal_id || !stage) {
          return { success: false, tool: toolName, error: 'deal_id and stage are required' };
        }

        // Resolve stage_id by name
        const { data: dealRow } = await supabase
          .from('deals')
          .select('pipeline_id')
          .eq('id', deal_id)
          .maybeSingle();

        let stageId: string | null = null;
        if (dealRow) {
          const { data: stageRow } = await supabase
            .from('pipeline_stages')
            .select('id')
            .eq('pipeline_id', dealRow.pipeline_id)
            .eq('name', stage)
            .maybeSingle();
          if (stageRow) stageId = stageRow.id;
        }

        const updatePayload: any = { stage };
        if (stageId) updatePayload.stage_id = stageId;

        const { data: deal, error } = await supabase
          .from('deals')
          .update(updatePayload)
          .eq('id', deal_id)
          .select('*')
          .single();

        if (error) throw error;
        return { success: true, tool: toolName, data: deal };
      }

      case 'send_sms_via_twilio': {
        const { contact_id, message } = args;
        if (!contact_id || !message) {
          return { success: false, tool: toolName, error: 'contact_id and message are required' };
        }

        // Fetch contact phone & resolve conversation to write into messages table (triggering WebSocket push)
        const { data: contact } = await supabase
          .from('contacts')
          .select('phone')
          .eq('id', contact_id)
          .maybeSingle();

        if (!contact) {
          return { success: false, tool: toolName, error: 'Contact not found' };
        }

        // Find/create conversation
        let conversationId: string | null = null;
        const { data: conv } = await supabase
          .from('conversations')
          .select('id')
          .eq('contact_id', contact_id)
          .maybeSingle();

        if (conv) {
          conversationId = conv.id;
        } else {
          const { data: newConv } = await supabase
            .from('conversations')
            .insert({
              account_id: accountId,
              user_id: await resolveDefaultUser(supabase, accountId),
              contact_id,
              status: 'open',
            })
            .select('id')
            .single();
          if (newConv) conversationId = newConv.id;
        }

        if (conversationId) {
          // Insert an OUTBOUND message (sender_type = agent/bot)
          // This automatically fires Supabase Realtime WebSocket update to any active agent UI!
          const { data: msg, error: msgError } = await supabase
            .from('messages')
            .insert({
              conversation_id: conversationId,
              sender_type: 'bot',
              content_type: 'text',
              content_text: message,
              status: 'sent',
              ai_generated: true,
            })
            .select('*')
            .single();

          if (msgError) throw msgError;

          // Simultaneously log the mock Twilio output
          console.log(`[Twilio Mock SMS] To: ${contact.phone}, Msg: "${message}"`);
          return { success: true, tool: toolName, data: { status: 'sent', message: msg } };
        }

        return { success: false, tool: toolName, error: 'Failed to find or create conversation' };
      }

      case 'send_email': {
        const { contact_id, subject, body } = args;
        if (!contact_id || !subject || !body) {
          return { success: false, tool: toolName, error: 'contact_id, subject, and body are required' };
        }

        // Create contact note representing the sent email for auditing
        const { data: note, error: noteError } = await supabase
          .from('contact_notes')
          .insert({
            contact_id,
            user_id: await resolveDefaultUser(supabase, accountId),
            account_id: accountId,
            note_text: `[Sent Email] Subject: ${subject}\n\n${body}`,
          })
          .select('*')
          .single();

        if (noteError) throw noteError;

        console.log(`[Email Mock Service] Subject: "${subject}", Body: "${body.substring(0, 100)}..."`);
        return { success: true, tool: toolName, data: note };
      }

      case 'schedule_viewing': {
        const { contact_id, property_id, scheduled_time, deal_id, feedback_notes } = args;
        if (!contact_id || !property_id || !scheduled_time) {
          return { success: false, tool: toolName, error: 'contact_id, property_id, and scheduled_time are required' };
        }

        const { data: booking, error } = await supabase
          .from('bookings')
          .insert({
            account_id: accountId,
            deal_id: deal_id || null,
            agent_id: await resolveDefaultUser(supabase, accountId),
            contact_id,
            property_id,
            scheduled_time,
            feedback_notes: feedback_notes || '',
            status: 'Scheduled',
          })
          .select('*')
          .single();

        if (error) throw error;

        // Dispatch outbound webhook for n8n/external systems
        dispatchWebhookEvent(supabase, accountId, 'booking.created', booking)
          .catch((err) => console.error('[AgentExecutor] Webhook dispatch error for booking.created:', err));

        return { success: true, tool: toolName, data: booking };
      }

      case 'pull_property_comps': {
        const { property_id, radius_miles } = args;
        if (!property_id) {
          return { success: false, tool: toolName, error: 'property_id is required' };
        }

        // Fetch reference property
        const { data: prop } = await supabase
          .from('properties')
          .select('*')
          .eq('account_id', accountId)
          .eq('id', property_id)
          .maybeSingle();

        if (!prop) {
          return { success: false, tool: toolName, error: 'Reference property not found' };
        }

        // Find similar properties in same account matching bed/bath metrics
        // In database, we can select matching beds and baths.
        let query = supabase
          .from('properties')
          .select('*')
          .eq('account_id', accountId)
          .neq('id', property_id);

        if (prop.beds !== undefined && prop.beds !== null) {
          query = query.eq('beds', prop.beds);
        }
        if (prop.baths !== undefined && prop.baths !== null) {
          query = query.eq('baths', prop.baths);
        }

        const { data: comps, error: compsError } = await query;
        if (compsError) throw compsError;

        const results = comps || [];
        const avgPrice = results.length > 0
          ? results.reduce((acc, c) => acc + c.price, 0) / results.length
          : prop.price;

        return {
          success: true,
          tool: toolName,
          data: {
            reference_property: prop,
            radius_miles: radius_miles || 1.0,
            comps_found: results.length,
            average_comp_price: avgPrice,
            comps: results,
          },
        };
      }

      default:
        return { success: false, tool: toolName, error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[AgentExecutor] Error executing tool '${toolName}':`, err);
    return { success: false, tool: toolName, error: err.message || 'Internal execution error' };
  }
}

/** Helper to find the default user_id to assign for bot/agent operations */
async function resolveDefaultUser(supabase: SupabaseClient, accountId: string): Promise<string> {
  const { data: account } = await supabase
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();

  if (account?.owner_user_id) {
    return account.owner_user_id;
  }

  // Fallback to first user in profiles
  const { data: prof } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();

  return prof?.user_id || '00000000-0000-0000-0000-000000000000';
}

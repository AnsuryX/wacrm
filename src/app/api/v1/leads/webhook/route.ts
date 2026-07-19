import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseUniversalLead } from '@/lib/real-estate/lead-parser';
import { findOrCreateContact, resolveAuditUserId } from '@/lib/api/v1/contacts';
import { triggerInboundTriageAgent } from '@/lib/ai/agent-workflows';

async function bootstrapPipelineAndStages(supabase: any, accountId: string, auditUserId: string) {
  // 1) Find existing pipeline
  const { data: pipelines } = await supabase
    .from('pipelines')
    .select('id, name')
    .eq('account_id', accountId)
    .limit(1);

  let pipelineId: string;
  if (pipelines && pipelines.length > 0) {
    pipelineId = pipelines[0].id;
  } else {
    // Create default pipeline
    const { data: newPipeline, error: pipelineError } = await supabase
      .from('pipelines')
      .insert({
        account_id: accountId,
        user_id: auditUserId,
        name: 'Real Estate Sales Pipeline',
      })
      .select('id')
      .single();

    if (pipelineError || !newPipeline) {
      throw new Error(`Failed to bootstrap pipeline: ${pipelineError?.message}`);
    }
    pipelineId = newPipeline.id;
  }

  // 2) Bootstrap stages: New Lead, Qualified, Viewing Scheduled, Offer Sent, Won, Lost
  const stagesToCreate = [
    { name: 'New Lead', position: 0, color: '#3b82f6' },
    { name: 'Qualified', position: 1, color: '#10b981' },
    { name: 'Viewing Scheduled', position: 2, color: '#f59e0b' },
    { name: 'Offer Sent', position: 3, color: '#8b5cf6' },
    { name: 'Won', position: 4, color: '#10b981' },
    { name: 'Lost', position: 5, color: '#ef4444' },
  ];

  // Fetch current stages
  const { data: currentStages } = await supabase
    .from('pipeline_stages')
    .select('id, name')
    .eq('pipeline_id', pipelineId);

  const stageIdsByName: Record<string, string> = {};
  if (currentStages) {
    for (const stage of currentStages) {
      stageIdsByName[stage.name] = stage.id;
    }
  }

  for (const item of stagesToCreate) {
    if (!stageIdsByName[item.name]) {
      const { data: newStage, error: stageError } = await supabase
        .from('pipeline_stages')
        .insert({
          pipeline_id: pipelineId,
          name: item.name,
          position: item.position,
          color: item.color,
        })
        .select('id')
        .single();

      if (newStage) {
        stageIdsByName[item.name] = newStage.id;
      }
    }
  }

  return {
    pipelineId,
    stageId: stageIdsByName['New Lead'] || stageIdsByName[stagesToCreate[0].name],
    allStages: stageIdsByName,
  };
}

export async function POST(request: Request) {
  try {
    // Authenticate the webhook request with the 'leads:write' scope
    const ctx = await requireApiKey(request, 'leads:write');

    const body = (await request.json().catch(() => null)) as Record<string, any> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    // Parse the payload using the universal parser
    const standardLead = parseUniversalLead(body);
    if (!standardLead.phone) {
      return fail('bad_request', 'Phone number is required in lead payload', 400);
    }

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    // Find or create the Contact
    const { id: contactId, created: contactCreated } = await findOrCreateContact(
      ctx.supabase,
      ctx.accountId,
      auditUserId,
      {
        phone: standardLead.phone,
        name: standardLead.name,
        email: standardLead.email,
      }
    );

    // Update real estate-specific details on the contact
    await ctx.supabase
      .from('contacts')
      .update({
        type: 'Buyer', // Default role for inbound webhook leads
        lead_source: standardLead.source,
        budget_max: standardLead.budget_max,
        budget_min: standardLead.budget_min,
        preferred_locations: standardLead.preferred_locations,
        requirements_beds: standardLead.requirements_beds,
        requirements_baths: standardLead.requirements_baths,
        requirements_property_type: standardLead.requirements_property_type,
      })
      .eq('id', contactId);

    // Bootstrap Pipeline and Stages
    const { pipelineId, stageId } = await bootstrapPipelineAndStages(ctx.supabase, ctx.accountId, auditUserId);

    // Resolve or create Conversation for Real-Time WebSocket Inbox delivery
    let conversationId: string | null = null;
    const { data: existingConv } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .maybeSingle();

    if (existingConv) {
      conversationId = existingConv.id;
    } else {
      const { data: newConv } = await ctx.supabase
        .from('conversations')
        .insert({
          account_id: ctx.accountId,
          user_id: auditUserId,
          contact_id: contactId,
          status: 'open',
          last_message_text: standardLead.message || 'New lead ingested',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (newConv) {
        conversationId = newConv.id;
      }
    }

    // Trigger WebSocket real-time UI message delivery by inserting a message row
    if (conversationId && standardLead.message) {
      await ctx.supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'customer',
          content_type: 'text',
          content_text: standardLead.message,
          status: 'read',
        });
    }

    // Create a new Deal linked to this contact and conversation
    const { data: deal, error: dealError } = await ctx.supabase
      .from('deals')
      .insert({
        account_id: ctx.accountId,
        user_id: auditUserId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contactId,
        conversation_id: conversationId || null,
        title: `${standardLead.name} - ${standardLead.source} Lead`,
        value: standardLead.budget_max || 0,
        notes: standardLead.message,
        stage: 'New Lead',
        commission_expectation: standardLead.budget_max ? standardLead.budget_max * 0.025 : null, // default 2.5% commission
      })
      .select('*')
      .single();

    if (dealError || !deal) {
      console.error('[lead-webhook] Failed to create deal:', dealError);
      return fail('internal', 'Failed to create deal for lead', 500);
    }

    // Async trigger: Inbound Triage Agent Workflow
    if (conversationId) {
      triggerInboundTriageAgent(ctx.supabase, ctx.accountId, contactId, deal.id, standardLead.message, standardLead.name)
        .catch((err) => console.error('[lead-webhook] Error in triage agent:', err));
    }

    return ok({
      success: true,
      contact_id: contactId,
      deal_id: deal.id,
      conversation_id: conversationId,
      created: contactCreated,
    }, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

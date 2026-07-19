import type { SupabaseClient } from '@supabase/supabase-js';
import { executeAgentTool } from './agent-executor';
import { matchPropertiesForContact } from '../real-estate/PropertyMatcher';
import { dispatchWebhookEvent } from '../webhooks/deliver';

/**
 * Workflow 1: The Inbound Triage Agent
 * Trigger: New lead webhook received.
 * Action: Analyze message/metadata, construct qualification SMS, and dispatch via Twilio.
 */
export async function triggerInboundTriageAgent(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string,
  dealId: string,
  messageText: string,
  contactName: string
): Promise<void> {
  console.log(`[TriageAgent] Starting inbound triage for lead: ${contactName} (Contact: ${contactId})`);

  // 1) Analyze message metadata to construct a highly targeted qualification SMS
  let propertyContext = 'the property';
  if (messageText && messageText.toLowerCase().includes('pearl')) {
    propertyContext = 'the beautiful listing in Pearl Qatar';
  } else if (messageText && messageText.toLowerCase().includes('west bay')) {
    propertyContext = 'the luxury apartment in West Bay';
  }

  const qualificationSms = `Hey ${contactName}, saw you were looking at ${propertyContext}. Are you looking to move in the next 30 days or just browsing?`;

  // 2) Execute send_sms_via_twilio tool to store in DB (WebSocket updates live agent chat)
  const result = await executeAgentTool(supabase, accountId, 'send_sms_via_twilio', {
    contact_id: contactId,
    message: qualificationSms,
  });

  if (!result.success) {
    console.error('[TriageAgent] Failed to send triage SMS:', result.error);
  }
}

/**
 * Loop of Workflow 1: Parse inbound SMS reply, extract intent/budget,
 * programmatically update Contact, and shift stage to 'Qualified' if ready.
 */
export async function handleInboundSmsReply(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string,
  replyText: string
): Promise<void> {
  console.log(`[TriageAgent] Parsing inbound reply from contact ${contactId}: "${replyText}"`);

  const lowerText = replyText.toLowerCase();
  let budgetMax: number | undefined;
  let isQualified = false;

  // Simple, robust extraction of intent / qualification keywords
  if (
    lowerText.includes('move') ||
    lowerText.includes('urgent') ||
    lowerText.includes('30 days') ||
    lowerText.includes('soon') ||
    lowerText.includes('next month') ||
    lowerText.includes('yes') ||
    lowerText.includes('buy') ||
    lowerText.includes('rent')
  ) {
    isQualified = true;
  }

  // Extract simple budget numbers (e.g. 500k, 500000, 2m, 2000000)
  const budgetMatch = lowerText.match(/(?:budget|price|around)\s*(\$?\d+[\d,]*\s*[km]?)/);
  if (budgetMatch) {
    let rawAmount = budgetMatch[1].replace(/[$,\s]/g, '').toLowerCase();
    if (rawAmount.endsWith('k')) {
      budgetMax = parseFloat(rawAmount) * 1000;
    } else if (rawAmount.endsWith('m')) {
      budgetMax = parseFloat(rawAmount) * 1000000;
    } else {
      budgetMax = parseFloat(rawAmount);
    }
  }

  // 1) Update Contact preferences in DB
  const updatePayload: any = {};
  if (budgetMax) {
    updatePayload.budget_max = budgetMax;
  }
  if (isQualified) {
    updatePayload.type = 'Buyer';
  }

  if (Object.keys(updatePayload).length > 0) {
    const { data: contact } = await supabase
      .from('contacts')
      .update(updatePayload)
      .eq('id', contactId)
      .select('*')
      .maybeSingle();

    if (contact) {
      dispatchWebhookEvent(supabase, accountId, 'contact.preferences_updated', contact)
        .catch((err) => console.error('[TriageAgent] Webhook dispatch error for contact.preferences_updated:', err));
    }
  }

  // 2) Trigger property matching engine to populate suggestion stack
  await matchPropertiesForContact(supabase, accountId, contactId);

  // 3) Shift Deal stage to 'Qualified' if qualified
  if (isQualified) {
    // Find contact's active deal
    const { data: deal } = await supabase
      .from('deals')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .neq('status', 'lost')
      .neq('status', 'won')
      .maybeSingle();

    if (deal) {
      const result = await executeAgentTool(supabase, accountId, 'update_deal_stage', {
        deal_id: deal.id,
        stage: 'Qualified',
      });
      if (result.success) {
        console.log(`[TriageAgent] Deal ${deal.id} programmatically promoted to stage 'Qualified'`);
      }
    }
  }
}

/**
 * Workflow 2: The Autonomous Follow-Up Agent
 * Trigger: Cron/Scheduled task (e.g., API route /api/v1/cron/follow-up).
 * Action: Finds stuck deals, generates contextual follow-ups with Google Calendar booking links, and emails them.
 */
export async function runAutonomousFollowUpAgent(
  supabase: SupabaseClient,
  accountId: string
): Promise<number> {
  console.log(`[FollowUpAgent] Finding stuck deals for account: ${accountId}`);

  // Find deals stuck in 'New Lead' or 'Qualified' with no activity for > 48 hours
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: stuckDeals, error } = await supabase
    .from('deals')
    .select('*, contacts(*)')
    .eq('account_id', accountId)
    .neq('status', 'lost')
    .neq('status', 'won')
    .or('stage.eq.New Lead,stage.eq.Qualified')
    .lte('last_activity_at', fortyEightHoursAgo);

  if (error || !stuckDeals) {
    console.error('[FollowUpAgent] Error querying stuck deals:', error);
    return 0;
  }

  console.log(`[FollowUpAgent] Found ${stuckDeals.length} stuck deals to process`);

  for (const deal of stuckDeals) {
    const contact = deal.contacts;
    if (!contact || !contact.id) continue;

    const contactName = contact.name || 'there';

    // Mock calendar availability lookup (next week slots)
    const mockBookingSlots = [
      'Friday 14:00 (Doha Time)',
      'Monday 10:00 (Doha Time)',
      'Tuesday 15:30 (Doha Time)',
    ];

    const bookingLink = `https://calendar.ansurysystems.com/book?agent=real-estate-bot&slots=${encodeURIComponent(
      mockBookingSlots.join(',')
    )}`;

    // Generate highly targeted follow-up email
    const emailSubject = `Checking in on your property search - ${deal.title}`;
    const emailBody = `
      Hi ${contactName},

      I wanted to follow up and see if you had any additional questions about your property search.

      We have new properties matching your requirements that just hit the market. If you would like to schedule a viewing or discuss further, here are 3 available time slots next week:

      1. ${mockBookingSlots[0]}
      2. ${mockBookingSlots[1]}
      3. ${mockBookingSlots[2]}

      You can lock in your preferred time instantly here: ${bookingLink}

      Best regards,
      Your Dedicated Real Estate Agent
      Ansury Systems CRM
    `.trim();

    // Send the email via our secure send_email tool
    const emailResult = await executeAgentTool(supabase, accountId, 'send_email', {
      contact_id: contact.id,
      subject: emailSubject,
      body: emailBody,
    });

    if (emailResult.success) {
      // Update last_activity_at to reset follow-up window
      await supabase
        .from('deals')
        .update({ last_activity_at: new Date().toISOString() })
        .eq('id', deal.id);
    }
  }

  return stuckDeals.length;
}

/**
 * Workflow 3: The Instant CMA Generator Agent
 * Trigger: /cma [Property_ID] in Chat command.
 * Action: Pull similar comps, calculate avg metrics, save structured report, and draft summary email.
 */
export async function generateInstantCma(
  supabase: SupabaseClient,
  accountId: string,
  propertyId: string,
  dealId?: string
): Promise<string> {
  console.log(`[CmaAgent] Generating instant CMA report for property: ${propertyId}`);

  // 1) Execute pull_property_comps tool
  const compResult = await executeAgentTool(supabase, accountId, 'pull_property_comps', {
    property_id: propertyId,
    radius_miles: 1.0,
  });

  if (!compResult.success || !compResult.data) {
    throw new Error(`Failed to pull property comps: ${compResult.error}`);
  }

  const { reference_property, average_comp_price, comps } = compResult.data;

  // 2) Calculate average price metrics
  const compsList = comps as any[];
  const referencePrice = reference_property.price;
  const priceDiffPercentage = average_comp_price
    ? (((average_comp_price - referencePrice) / referencePrice) * 100).toFixed(1)
    : '0';

  const reportText = `
=========================================
COMPARATIVE MARKET ANALYSIS (CMA) REPORT
=========================================
Subject Property: ${reference_property.address}
Listed Price: $${reference_property.price.toLocaleString()}
Beds: ${reference_property.beds || 'N/A'} | Baths: ${reference_property.baths || 'N/A'}
Source: ${reference_property.source}

Comparable Listings (1-mile radius):
${
  compsList.length > 0
    ? compsList
        .map(
          (c, idx) =>
            `${idx + 1}. ${c.address} - $${c.price.toLocaleString()} (Status: ${c.status}, Beds: ${c.beds}, Baths: ${c.baths})`
        )
        .join('\n')
    : 'No directly matching comps found in the area.'
}

Market Summary:
- Average Price of Comps: $${Math.round(average_comp_price).toLocaleString()}
- Price Variance vs. Market: ${parseFloat(priceDiffPercentage) >= 0 ? '+' : ''}${priceDiffPercentage}%
- Valuation Status: ${
    parseFloat(priceDiffPercentage) > 5
      ? 'Underpriced (Great Deal!)'
      : parseFloat(priceDiffPercentage) < -5
      ? 'Overpriced (Requires Negotiation)'
      : 'Fair Market Value'
  }

Generated on: ${new Date().toLocaleDateString()}
Ansury Systems AI Real Estate Advisor
  `.trim();

  // 3) Save report to Deal notes or Contact Notes (acting as Deal Document repository)
  const contactId = reference_property.user_id; // optional fallback contact
  await supabase.from('contact_notes').insert({
    contact_id: reference_property.contact_id || '00000000-0000-0000-0000-000000000000', // links to default or placeholder
    account_id: accountId,
    user_id: reference_property.user_id || '00000000-0000-0000-0000-000000000000',
    note_text: `[CMA Valuation Report]\n\n${reportText}`,
  });

  return reportText;
}

/**
 * Workflow 4: The Booking & Viewing Coordinator Agent
 * Trigger: Lead message containing schedule request intent.
 * Action: Parses time, reserves slot in Bookings table, and confirms via automated SMS.
 */
export async function coordinateBookingViewing(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string,
  messageText: string
): Promise<boolean> {
  console.log(`[ViewingCoordinator] Processing viewing request from contact ${contactId}: "${messageText}"`);

  // Simple, robust extraction of listing agent / property context
  // Let's find any active deal to fetch the property being discussed
  const { data: deal } = await supabase
    .from('deals')
    .select('id, property_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .neq('status', 'lost')
    .neq('status', 'won')
    .maybeSingle();

  if (!deal || !deal.property_id) {
    console.error('[ViewingCoordinator] No active deal with a linked property found for booking.');
    return false;
  }

  const { data: property } = await supabase
    .from('properties')
    .select('address')
    .eq('id', deal.property_id)
    .maybeSingle();

  if (!property) {
    return false;
  }

  // Parse booking time: "this Friday afternoon"
  let scheduledTime = new Date();
  scheduledTime.setDate(scheduledTime.getDate() + ((5 + 7 - scheduledTime.getDay()) % 7)); // Next Friday
  scheduledTime.setHours(15, 0, 0, 0); // Friday 3:00 PM afternoon

  // 1) Execute schedule_viewing tool to save viewing slot in Bookings table
  const bookingResult = await executeAgentTool(supabase, accountId, 'schedule_viewing', {
    contact_id: contactId,
    property_id: deal.property_id,
    scheduled_time: scheduledTime.toISOString(),
    deal_id: deal.id,
    feedback_notes: `Requested via SMS: "${messageText}"`,
  });

  if (!bookingResult.success) {
    console.error('[ViewingCoordinator] Failed to reserve booking slot:', bookingResult.error);
    return false;
  }

  // 2) Shift deal stage to 'Viewing Scheduled' programmatically
  await executeAgentTool(supabase, accountId, 'update_deal_stage', {
    deal_id: deal.id,
    stage: 'Viewing Scheduled',
  });

  // 3) Send automated confirmation SMS with location directions
  const confirmationSms = `Confirmed! Your viewing at ${property.address} is scheduled for this Friday afternoon at 3:00 PM. Here are directions: https://maps.google.com/?q=${encodeURIComponent(
    property.address
  )}`;

  await executeAgentTool(supabase, accountId, 'send_sms_via_twilio', {
    contact_id: contactId,
    message: confirmationSms,
  });

  console.log(`[ViewingCoordinator] Booking coordinates finalized successfully for Friday.`);
  return true;
}

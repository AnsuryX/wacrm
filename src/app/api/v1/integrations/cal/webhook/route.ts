import { supabaseAdmin } from '@/lib/flows/admin-client';
import { ok, fail } from '@/lib/api/v1/respond';
import { findOrCreateContact } from '@/lib/api/v1/contacts';

export async function POST(request: Request) {
  try {
    const payload = await request.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return fail('bad_request', 'Invalid JSON payload', 400);
    }

    // Cal.com webhook payloads typically wrap details in a 'payload' field
    const bookingData = payload.payload || payload;
    const { title, startTime, endTime, description, attendees, uid } = bookingData;

    if (!attendees || attendees.length === 0 || !startTime) {
      return fail('bad_request', 'Missing attendees or startTime', 400);
    }

    const attendee = attendees[0];
    const email = attendee.email || '';
    const name = attendee.name || 'Cal.com Lead';
    const phone = attendee.phoneNumber || attendee.phone || '';

    if (!phone && !email) {
      return fail('bad_request', 'Attendee must have a valid phone number or email', 400);
    }

    const supabase = supabaseAdmin();

    // 1) Find the account_id dynamically
    // Cal.com webhooks can pass account_id in query parameters or we fall back to the first account
    const url = new URL(request.url);
    let accountId = url.searchParams.get('accountId');

    if (!accountId) {
      const { data: firstAccount } = await supabase.from('accounts').select('id, owner_user_id').limit(1).single();
      if (!firstAccount) {
        return fail('internal', 'No workspace account resolved.', 500);
      }
      accountId = firstAccount.id;
    }

    // Re-verify accountId is string for TS compiler
    const resolvedAccountId = accountId as string;

    // Resolve default user_id for auditing
    const { data: account } = await supabase.from('accounts').select('owner_user_id').eq('id', resolvedAccountId).single();
    const auditUserId = account?.owner_user_id || '00000000-0000-0000-0000-000000000000';

    // 2) Find or Create Contact by phone (or email fallback)
    let contactId: string;
    try {
      const { id } = await findOrCreateContact(supabase, resolvedAccountId, auditUserId, {
        phone: phone || '+15551234567', // fallback dummy number if phone empty (emails are handled separately)
        name,
        email,
      });
      contactId = id;
    } catch (err: any) {
      // Fallback: manually fetch if phone is invalid for E164 to prevent failing the webhook
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id')
        .eq('account_id', resolvedAccountId)
        .eq('email', email)
        .limit(1)
        .maybeSingle();

      if (existingContact) {
        contactId = existingContact.id;
      } else {
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            account_id: resolvedAccountId,
            user_id: auditUserId,
            name,
            phone: phone || '+15551234567',
            email,
          })
          .select('id')
          .single();
        contactId = newContact!.id;
      }
    }

    // 3) Find first active property to link (if booking title mentions address) or default to first active property
    const { data: firstProperty } = await supabase
      .from('properties')
      .select('id')
      .eq('account_id', resolvedAccountId)
      .eq('status', 'Active')
      .limit(1)
      .maybeSingle();

    if (!firstProperty) {
      return fail('bad_request', 'No active properties configured to book against.', 400);
    }

    // 4) Insert Booking entry
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .insert({
        account_id: resolvedAccountId,
        contact_id: contactId,
        property_id: firstProperty.id,
        scheduled_time: new Date(startTime).toISOString(),
        feedback_notes: `[Cal.com Automated Booking]\nUID: ${uid || 'N/A'}\nTitle: ${title}\nDescription: ${description || 'N/A'}\nEnd: ${endTime || 'N/A'}`,
        status: 'Scheduled',
        external_event_id: uid || null,
      })
      .select('*')
      .single();

    if (bookingError || !booking) {
      console.error('[cal/webhook] Booking insert failed:', bookingError);
      return fail('internal', 'Failed to store booking entry.', 500);
    }

    // 5) Promote any active deal for this contact to 'Viewing Scheduled'
    const { data: activeDeal } = await supabase
      .from('deals')
      .select('id')
      .eq('account_id', resolvedAccountId)
      .eq('contact_id', contactId)
      .neq('status', 'lost')
      .neq('status', 'won')
      .maybeSingle();

    if (activeDeal) {
      await supabase
        .from('deals')
        .update({ stage_text: 'Viewing Scheduled' })
        .eq('id', activeDeal.id);
    }

    return ok({ success: true, booking_id: booking.id });
  } catch (err: any) {
    console.error('[cal/webhook] uncaught error:', err);
    return fail('internal', err.message || 'Internal server error', 500);
  }
}

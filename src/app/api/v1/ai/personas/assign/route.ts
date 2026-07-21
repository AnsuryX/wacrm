import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function PATCH(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');

    const body = (await request.json().catch(() => null)) as Record<string, any> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const { contact_id, deal_id, active_persona_id } = body;
    if (!contact_id && !deal_id) {
      return fail('bad_request', 'Either contact_id or deal_id must be provided', 400);
    }

    const personaId = active_persona_id || null;

    if (contact_id) {
      const { error } = await ctx.supabase
        .from('contacts')
        .update({ active_persona_id: personaId })
        .eq('account_id', ctx.accountId)
        .eq('id', contact_id);

      if (error) {
        console.error('[personas/assign] error updating contact:', error);
        return fail('internal', 'Failed to update contact persona assignment', 500);
      }
    }

    if (deal_id) {
      const { error } = await ctx.supabase
        .from('deals')
        .update({ active_persona_id: personaId })
        .eq('account_id', ctx.accountId)
        .eq('id', deal_id);

      if (error) {
        console.error('[personas/assign] error updating deal:', error);
        return fail('internal', 'Failed to update deal persona assignment', 500);
      }
    }

    return ok({ success: true, assigned_persona_id: personaId });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

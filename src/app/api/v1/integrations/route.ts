import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { data: integrations, error } = await ctx.supabase
      .from('integrations')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[api/v1/integrations] fetch error:', error);
      return fail('internal', 'Failed to retrieve calendar integrations', 500);
    }

    return ok(integrations);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

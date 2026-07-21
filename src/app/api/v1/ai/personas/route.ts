import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');

    const { data: personas, error } = await ctx.supabase
      .from('agent_personas')
      .select('*')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[api/v1/ai/personas] list error:', error);
      return fail('internal', 'Failed to list agent personas', 500);
    }

    return ok(personas);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'webhooks:manage');

    const body = (await request.json().catch(() => null)) as Record<string, any> | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const { name, role, specialty_badge, tone, greeting_style, connected_capabilities } = body;
    if (!name || !role || !tone || !greeting_style) {
      return fail('bad_request', 'name, role, tone, and greeting_style are required', 400);
    }

    const { data: created, error } = await ctx.supabase
      .from('agent_personas')
      .insert({
        account_id: ctx.accountId,
        name,
        role,
        specialty_badge: specialty_badge || 'Advisor',
        tone,
        greeting_style,
        connected_capabilities: connected_capabilities || [],
        active: true,
      })
      .select('*')
      .single();

    if (error || !created) {
      console.error('[api/v1/ai/personas] create error:', error);
      return fail('internal', 'Failed to create agent persona', 500);
    }

    return ok(created, 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';

export async function GET(request: Request) {
  try {
    // Authenticate the request using contacts:read scope
    const ctx = await requireApiKey(request, 'contacts:read');

    const url = new URL(request.url);
    const minLatStr = url.searchParams.get('minLat');
    const maxLatStr = url.searchParams.get('maxLat');
    const minLngStr = url.searchParams.get('minLng');
    const maxLngStr = url.searchParams.get('maxLng');

    let query = ctx.supabase
      .from('properties')
      .select('*')
      .eq('account_id', ctx.accountId)
      .not('coordinates_lat', 'is', null)
      .not('coordinates_lng', 'is', null);

    // Apply bounding box constraints if all are present
    if (minLatStr && maxLatStr && minLngStr && maxLngStr) {
      const minLat = parseFloat(minLatStr);
      const maxLat = parseFloat(maxLatStr);
      const minLng = parseFloat(minLngStr);
      const maxLng = parseFloat(maxLngStr);

      if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLng) || isNaN(maxLng)) {
        return fail('bad_request', 'Bounding box coordinates must be valid numbers', 400);
      }

      query = query
        .gte('coordinates_lat', minLat)
        .lte('coordinates_lat', maxLat)
        .gte('coordinates_lng', minLng)
        .lte('coordinates_lng', maxLng);
    }

    const { data: properties, error } = await query;
    if (error) {
      console.error('[properties/map] Error fetching map properties:', error);
      return fail('internal', 'Failed to retrieve properties for map', 500);
    }

    return ok(properties);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

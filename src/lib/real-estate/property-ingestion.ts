import type { SupabaseClient } from '@supabase/supabase-js';
import type { Property, PropertySource, PropertyStatus } from '@/types';

export interface RawMlsPayload {
  mlsId: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  listPrice: number;
  bedrooms?: number;
  bathrooms?: number;
  latitude?: string | number;
  longitude?: string | number;
  remarks?: string;
  amenities?: string[];
  status?: string;
}

export interface RawPropertyFinderPayload {
  reference: string;
  title: string;
  location: string;
  price: number;
  beds?: number;
  baths?: number;
  lat?: string | number;
  lng?: string | number;
  description?: string;
  amenities?: string[];
  propertyStatus?: string;
}

export interface RawBayutPayload {
  bayutId: string;
  addressName: string;
  rentOrSalePrice: number;
  numBeds?: number;
  numBaths?: number;
  geocoordinates?: {
    lat?: string | number;
    lon?: string | number;
  };
  desc?: string;
  amenitiesList?: string[];
  statusActive?: boolean;
}

export function parseCoordinates(
  lat: string | number | undefined | null,
  lng: string | number | undefined | null
): { lat: number | null; lng: number | null } {
  let parsedLat: number | null = null;
  let parsedLng: number | null = null;

  if (lat !== undefined && lat !== null) {
    const num = typeof lat === 'number' ? lat : parseFloat(lat);
    if (!isNaN(num)) parsedLat = num;
  }
  if (lng !== undefined && lng !== null) {
    const num = typeof lng === 'number' ? lng : parseFloat(lng);
    if (!isNaN(num)) parsedLng = num;
  }

  return { lat: parsedLat, lng: parsedLng };
}

export function mapMlsToProperty(raw: RawMlsPayload, accountId: string, userId?: string | null): Partial<Property> {
  const { lat, lng } = parseCoordinates(raw.latitude, raw.longitude);

  let mappedStatus: PropertyStatus = 'Active';
  if (raw.status) {
    const s = raw.status.toLowerCase();
    if (s.includes('pending')) mappedStatus = 'Pending';
    else if (s.includes('sold')) mappedStatus = 'Sold';
    else if (s.includes('off') || s.includes('market')) mappedStatus = 'Off-Market';
  }

  return {
    account_id: accountId,
    user_id: userId || null,
    source: 'MLS',
    source_id: raw.mlsId,
    address: `${raw.streetAddress}, ${raw.city}, ${raw.state} ${raw.zip}`,
    coordinates_lat: lat,
    coordinates_lng: lng,
    price: raw.listPrice,
    beds: raw.bedrooms || null,
    baths: raw.bathrooms || null,
    status: mappedStatus,
    features: raw.amenities || [],
    description: raw.remarks || null,
  };
}

export function mapPropertyFinderToProperty(raw: RawPropertyFinderPayload, accountId: string, userId?: string | null): Partial<Property> {
  const { lat, lng } = parseCoordinates(raw.lat, raw.lng);

  let mappedStatus: PropertyStatus = 'Active';
  if (raw.propertyStatus) {
    const s = raw.propertyStatus.toLowerCase();
    if (s.includes('pending')) mappedStatus = 'Pending';
    else if (s.includes('sold')) mappedStatus = 'Sold';
    else if (s.includes('off') || s.includes('market')) mappedStatus = 'Off-Market';
  }

  return {
    account_id: accountId,
    user_id: userId || null,
    source: 'Property Finder',
    source_id: raw.reference,
    address: raw.location || raw.title,
    coordinates_lat: lat,
    coordinates_lng: lng,
    price: raw.price,
    beds: raw.beds || null,
    baths: raw.baths || null,
    status: mappedStatus,
    features: raw.amenities || [],
    description: raw.description || null,
  };
}

export function mapBayutToProperty(raw: RawBayutPayload, accountId: string, userId?: string | null): Partial<Property> {
  const geoLat = raw.geocoordinates?.lat;
  const geoLon = raw.geocoordinates?.lon;
  const { lat, lng } = parseCoordinates(geoLat, geoLon);

  let mappedStatus: PropertyStatus = 'Active';
  if (raw.statusActive === false) {
    mappedStatus = 'Off-Market';
  }

  return {
    account_id: accountId,
    user_id: userId || null,
    source: 'Bayut',
    source_id: raw.bayutId,
    address: raw.addressName,
    coordinates_lat: lat,
    coordinates_lng: lng,
    price: raw.rentOrSalePrice,
    beds: raw.numBeds || null,
    baths: raw.numBaths || null,
    status: mappedStatus,
    features: raw.amenitiesList || [],
    description: raw.desc || null,
  };
}

export async function ingestProperty(
  supabase: SupabaseClient,
  accountId: string,
  userId: string | null,
  source: PropertySource,
  payload: any
): Promise<Property> {
  let propertyData: Partial<Property>;

  switch (source) {
    case 'MLS':
      propertyData = mapMlsToProperty(payload as RawMlsPayload, accountId, userId);
      break;
    case 'Property Finder':
      propertyData = mapPropertyFinderToProperty(payload as RawPropertyFinderPayload, accountId, userId);
      break;
    case 'Bayut':
      propertyData = mapBayutToProperty(payload as RawBayutPayload, accountId, userId);
      break;
    case 'Internal':
      propertyData = {
        account_id: accountId,
        user_id: userId,
        source: 'Internal',
        source_id: payload.source_id || null,
        address: payload.address,
        coordinates_lat: payload.coordinates_lat || null,
        coordinates_lng: payload.coordinates_lng || null,
        price: payload.price,
        beds: payload.beds || null,
        baths: payload.baths || null,
        status: payload.status || 'Active',
        features: payload.features || [],
        description: payload.description || null,
      };
      break;
    default:
      throw new Error(`Unsupported property source: ${source}`);
  }

  if (!propertyData.address) {
    throw new Error('Property address is required');
  }
  if (!propertyData.price) {
    throw new Error('Property price is required');
  }

  // Find if property already exists by source + source_id within the account, else insert
  if (propertyData.source_id) {
    const { data: existing, error: fetchError } = await supabase
      .from('properties')
      .select('*')
      .eq('account_id', accountId)
      .eq('source', source)
      .eq('source_id', propertyData.source_id)
      .maybeSingle();

    if (fetchError) {
      console.error('[property-ingestion] Error fetching existing property:', fetchError);
    }

    if (existing) {
      const { data: updated, error: updateError } = await supabase
        .from('properties')
        .update(propertyData)
        .eq('id', existing.id)
        .select('*')
        .single();

      if (updateError) {
        throw new Error(`Failed to update property: ${updateError.message}`);
      }
      return updated as Property;
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('properties')
    .insert(propertyData)
    .select('*')
    .single();

  if (insertError) {
    throw new Error(`Failed to insert property: ${insertError.message}`);
  }

  return inserted as Property;
}

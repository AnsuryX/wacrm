import type { SupabaseClient } from '@supabase/supabase-js';
import type { Contact, Property, Deal } from '@/types';

/**
 * Pairs a single contact's preferences against the active property inventory.
 * Filters by beds, baths, price, and preferred locations, then updates the
 * suggested_property_ids array on any associated active deals.
 */
export async function matchPropertiesForContact(
  supabase: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<string[]> {
  // 1) Fetch contact preferences
  const { data: contact, error: contactError } = await supabase
    .from('contacts')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle();

  if (contactError || !contact) {
    console.error('[PropertyMatcher] Contact not found or error:', contactError);
    return [];
  }

  // If the contact is not a Buyer or Renter, skip matching
  if (contact.type && contact.type !== 'Buyer' && contact.type !== 'Renter') {
    return [];
  }

  // 2) Query active properties
  let query = supabase
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'Active');

  if (contact.requirements_beds !== undefined && contact.requirements_beds !== null) {
    query = query.gte('beds', contact.requirements_beds);
  }
  if (contact.requirements_baths !== undefined && contact.requirements_baths !== null) {
    query = query.gte('baths', contact.requirements_baths);
  }
  if (contact.budget_min !== undefined && contact.budget_min !== null) {
    query = query.gte('price', contact.budget_min);
  }
  if (contact.budget_max !== undefined && contact.budget_max !== null) {
    query = query.lte('price', contact.budget_max);
  }

  const { data: properties, error: propertiesError } = await query;
  if (propertiesError || !properties) {
    console.error('[PropertyMatcher] Error fetching properties:', propertiesError);
    return [];
  }

  // 3) Filter by preferred locations (in-memory case-insensitive overlap)
  const preferredLocs: string[] = contact.preferred_locations || [];
  let matchedProperties = properties as Property[];

  if (preferredLocs.length > 0) {
    matchedProperties = matchedProperties.filter((prop) => {
      const addressLower = (prop.address || '').toLowerCase();
      const descLower = (prop.description || '').toLowerCase();
      return preferredLocs.some((loc) => {
        const locLower = loc.toLowerCase().trim();
        return addressLower.includes(locLower) || descLower.includes(locLower);
      });
    });
  }

  const matchedIds = matchedProperties.map((p) => p.id);

  // 4) Update active Deals suggested stack
  const { data: deals, error: dealsError } = await supabase
    .from('deals')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .neq('status', 'lost')
    .neq('status', 'won');

  if (dealsError) {
    console.error('[PropertyMatcher] Error fetching deals:', dealsError);
  }

  if (deals && deals.length > 0) {
    const dealIds = deals.map((d) => d.id);
    await supabase
      .from('deals')
      .update({ suggested_property_ids: matchedIds })
      .in('id', dealIds);
  }

  return matchedIds;
}

/**
 * Converse trigger: When a new property is created or updated, finds all
 * contacts whose preferences match this property, and appends the property id
 * to their active deals' suggested inventory stack.
 */
export async function matchContactsForProperty(
  supabase: SupabaseClient,
  accountId: string,
  propertyId: string
): Promise<string[]> {
  // 1) Fetch property
  const { data: property, error: propError } = await supabase
    .from('properties')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', propertyId)
    .maybeSingle();

  if (propError || !property) {
    console.error('[PropertyMatcher] Property not found or error:', propError);
    return [];
  }

  if (property.status !== 'Active') {
    return [];
  }

  // 2) Query contacts with matching preferences
  let query = supabase
    .from('contacts')
    .select('*')
    .eq('account_id', accountId);

  // Apply filters on contact preferences based on the property attributes
  // Bed & bath preferences must be <= property availability
  if (property.beds !== undefined && property.beds !== null) {
    query = query.or(`requirements_beds.is.null,requirements_beds.lte.${property.beds}`);
  }
  if (property.baths !== undefined && property.baths !== null) {
    query = query.or(`requirements_baths.is.null,requirements_baths.lte.${property.baths}`);
  }

  const { data: contacts, error: contactsError } = await query;
  if (contactsError || !contacts) {
    console.error('[PropertyMatcher] Error fetching contacts:', contactsError);
    return [];
  }

  const matchedContactIds: string[] = [];

  for (const contact of (contacts as Contact[])) {
    // Check price bounds
    if (contact.budget_min !== undefined && contact.budget_min !== null && property.price < contact.budget_min) {
      continue;
    }
    if (contact.budget_max !== undefined && contact.budget_max !== null && property.price > contact.budget_max) {
      continue;
    }

    // Check preferred locations
    const preferredLocs = contact.preferred_locations || [];
    if (preferredLocs.length > 0) {
      const addressLower = (property.address || '').toLowerCase();
      const descLower = (property.description || '').toLowerCase();
      const matchesLocation = preferredLocs.some((loc) => {
        const locLower = loc.toLowerCase().trim();
        return addressLower.includes(locLower) || descLower.includes(locLower);
      });
      if (!matchesLocation) continue;
    }

    matchedContactIds.push(contact.id);

    // Update active deals suggest stack
    const { data: deals } = await supabase
      .from('deals')
      .select('id, suggested_property_ids')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .neq('status', 'lost')
      .neq('status', 'won');

    if (deals && deals.length > 0) {
      for (const deal of deals) {
        const currentStack: string[] = deal.suggested_property_ids || [];
        if (!currentStack.includes(propertyId)) {
          await supabase
            .from('deals')
            .update({ suggested_property_ids: [...currentStack, propertyId] })
            .eq('id', deal.id);
        }
      }
    }
  }

  return matchedContactIds;
}

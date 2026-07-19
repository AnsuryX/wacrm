import type { StandardLead } from '@/types';

export function parseUniversalLead(payload: any): StandardLead {
  let name = payload.name || '';
  let phone = payload.phone || '';
  let email = payload.email || '';
  let source = payload.source || payload.lead_source || payload.leadSource || 'Unknown';
  let message = payload.message || payload.comments || payload.notes || '';
  let budget_max = payload.budget_max || payload.budget || undefined;
  let budget_min = payload.budget_min || undefined;
  let preferred_locations: string[] = payload.preferred_locations || payload.locations || [];
  let requirements_beds = payload.requirements_beds || payload.beds || undefined;
  let requirements_baths = payload.requirements_baths || payload.baths || undefined;
  let requirements_property_type = payload.requirements_property_type || payload.property_type || undefined;

  // 1) Parse Facebook Lead Ads
  if (Array.isArray(payload.field_data)) {
    source = 'Facebook';
    for (const field of payload.field_data) {
      const fieldName = field.name?.toLowerCase();
      const value = field.values?.[0] || '';
      if (!value) continue;

      if (fieldName.includes('full_name') || fieldName.includes('name')) {
        name = value;
      } else if (fieldName.includes('phone')) {
        phone = value;
      } else if (fieldName.includes('email')) {
        email = value;
      } else if (fieldName.includes('budget') || fieldName.includes('price')) {
        const parsedPrice = parseFloat(value.replace(/[^\d.]/g, ''));
        if (!isNaN(parsedPrice)) budget_max = parsedPrice;
      } else if (fieldName.includes('location') || fieldName.includes('neighborhood') || fieldName.includes('area') || fieldName.includes('region')) {
        preferred_locations.push(value);
      } else if (fieldName.includes('message') || fieldName.includes('question')) {
        message += (message ? '\n' : '') + `${field.name}: ${value}`;
      }
    }
  }

  // 2) Parse Zillow Structure
  if (payload.lead?.contact) {
    source = 'Zillow';
    const c = payload.lead.contact;
    name = c.name || name;
    phone = c.phone || phone;
    email = c.email || email;

    const inquiry = payload.lead.inquiry;
    if (inquiry) {
      message = inquiry.message || message;
      if (inquiry.propertyAddress) {
        message += `\nProperty of Interest: ${inquiry.propertyAddress}`;
        preferred_locations.push(inquiry.propertyAddress);
      }
    }
  }

  // 3) Parse Realtor.com Structure
  if (payload.customer_name || payload.customer_phone || payload.customer_email) {
    source = 'Realtor.com';
    name = payload.customer_name || name;
    phone = payload.customer_phone || phone;
    email = payload.customer_email || email;
    if (payload.property) {
      if (payload.property.price) budget_max = payload.property.price;
      if (payload.property.address) {
        message += `\nInquired Property: ${payload.property.address}`;
        preferred_locations.push(payload.property.address);
      }
    }
  }

  // 4) Parse Property Finder Webhook Format
  if (payload.reference && (payload.contactName || payload.contactPhone || payload.contactEmail)) {
    source = 'Property Finder';
    name = payload.contactName || name;
    phone = payload.contactPhone || phone;
    email = payload.contactEmail || email;
    message = payload.notes || message;
    message += `\nProperty Ref: ${payload.reference}`;
  }

  // 5) Parse Bayut Webhook Format
  if (payload.bayutId && (payload.leadPhone || payload.leadName || payload.leadEmail)) {
    source = 'Bayut';
    name = payload.leadName || name;
    phone = payload.leadPhone || phone;
    email = payload.leadEmail || email;
    message = payload.leadMessage || payload.notes || message;
    message += `\nBayut Ref: ${payload.bayutId}`;
  }

  // Fallbacks & defaults
  name = name.trim() || 'New Lead';
  phone = phone.trim();
  email = email.trim();
  source = source.trim();
  message = message.trim();

  return {
    name,
    phone,
    email,
    source,
    message,
    budget_min,
    budget_max,
    preferred_locations,
    requirements_beds,
    requirements_baths,
    requirements_property_type,
  };
}

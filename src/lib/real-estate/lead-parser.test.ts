import { describe, expect, it } from 'vitest';
import { parseUniversalLead } from './lead-parser';

describe('parseUniversalLead', () => {
  it('parses a basic standard payload', () => {
    const raw = {
      name: 'John Doe',
      phone: '+15551234567',
      email: 'john@example.com',
      source: 'Zillow',
      message: 'Looking for a 2-bed in Doha',
      budget: 500000,
    };

    const parsed = parseUniversalLead(raw);

    expect(parsed).toEqual({
      name: 'John Doe',
      phone: '+15551234567',
      email: 'john@example.com',
      source: 'Zillow',
      message: 'Looking for a 2-bed in Doha',
      budget_min: undefined,
      budget_max: 500000,
      preferred_locations: [],
      requirements_beds: undefined,
      requirements_baths: undefined,
      requirements_property_type: undefined,
    });
  });

  it('parses Facebook Lead Ads payload', () => {
    const raw = {
      field_data: [
        { name: 'full_name', values: ['Jane Smith'] },
        { name: 'phone_number', values: ['+97455551234'] },
        { name: 'email', values: ['jane@example.com'] },
        { name: 'estimated_budget', values: ['1,200,000'] },
        { name: 'preferred_neighborhood', values: ['Pearl Qatar'] },
      ],
    };

    const parsed = parseUniversalLead(raw);

    expect(parsed).toEqual({
      name: 'Jane Smith',
      phone: '+97455551234',
      email: 'jane@example.com',
      source: 'Facebook',
      message: '',
      budget_min: undefined,
      budget_max: 1200000,
      preferred_locations: ['Pearl Qatar'],
      requirements_beds: undefined,
      requirements_baths: undefined,
      requirements_property_type: undefined,
    });
  });

  it('parses Property Finder webhook payload', () => {
    const raw = {
      reference: 'PF-999',
      contactName: 'Ahmed Ali',
      contactPhone: '+97433334444',
      contactEmail: 'ahmed@example.com',
      notes: 'Is this negotiable?',
    };

    const parsed = parseUniversalLead(raw);

    expect(parsed.name).toBe('Ahmed Ali');
    expect(parsed.phone).toBe('+97433334444');
    expect(parsed.email).toBe('ahmed@example.com');
    expect(parsed.source).toBe('Property Finder');
    expect(parsed.message).toContain('Is this negotiable?');
    expect(parsed.message).toContain('Property Ref: PF-999');
  });
});

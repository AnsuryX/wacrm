import { describe, expect, it, vi } from 'vitest';
import { matchPropertiesForContact } from './PropertyMatcher';

describe('PropertyMatcher', () => {
  it('matchPropertiesForContact fetches contact and queries matching active properties', async () => {
    const mockContact = {
      id: 'contact-1',
      account_id: 'account-123',
      type: 'Buyer',
      requirements_beds: 2,
      requirements_baths: 2,
      budget_min: 100000,
      budget_max: 500000,
      preferred_locations: ['Pearl Qatar'],
    };

    // prop-2 is excluded from db query because it exceeds budget_max of 500000.
    // prop-3 is returned by db query but excluded by location filter in-memory.
    const mockPropertiesFilteredByDb = [
      {
        id: 'prop-1',
        address: 'Beautiful Sea View 2BR, Pearl Qatar, Doha',
        price: 350000,
        beds: 2,
        baths: 2,
        status: 'Active',
      },
      {
        id: 'prop-3',
        address: 'Cozy 1BR in West Bay, Doha',
        price: 200000,
        beds: 1,
        baths: 1,
        status: 'Active',
      },
    ];

    const mockDeals = [{ id: 'deal-1' }];

    // Simple, clean mock builder
    const makeBuilder = (data: any) => {
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ error: null }),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        single: vi.fn().mockResolvedValue({ data, error: null }),
        update: vi.fn().mockReturnThis(),
        then: (onfulfilled: any) => onfulfilled({ data, error: null }),
      };
      return builder;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table) => {
        if (table === 'contacts') return makeBuilder(mockContact);
        if (table === 'properties') return makeBuilder(mockPropertiesFilteredByDb);
        if (table === 'deals') return makeBuilder(mockDeals);
        return makeBuilder(null);
      }),
    } as any;

    const matches = await matchPropertiesForContact(mockSupabase, 'account-123', 'contact-1');

    expect(matches).toEqual(['prop-1']);
  });
});

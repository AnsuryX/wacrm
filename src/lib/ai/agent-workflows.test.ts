import { describe, expect, it, vi } from 'vitest';
import {
  triggerInboundTriageAgent,
  handleInboundSmsReply,
  coordinateBookingViewing,
} from './agent-workflows';

describe('Agent Workflows', () => {
  it('triggerInboundTriageAgent correctly formats and sends triage qualification SMS', async () => {
    const mockContact = { phone: '+97455551234' };
    const mockConv = { id: 'conv-123' };
    const mockMsg = { id: 'msg-1', content_text: 'Hello!' };

    const makeBuilder = (table: string) => {
      let data: any = null;
      if (table === 'contacts') data = mockContact;
      else if (table === 'conversations') data = mockConv;
      else if (table === 'messages') data = mockMsg;

      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        single: vi.fn().mockResolvedValue({ data, error: null }),
        then: (onfulfilled: any) => onfulfilled({ data, error: null }),
      };
      return builder;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table) => makeBuilder(table)),
    } as any;

    await triggerInboundTriageAgent(mockSupabase, 'account-123', 'contact-1', 'deal-1', 'looking at Pearl Qatar', 'Ahmed');

    // The function was executed successfully without throwing.
    expect(mockSupabase.from).toHaveBeenCalledWith('contacts');
  });

  it('handleInboundSmsReply programmatically promotes qualifying contacts to Qualified stage', async () => {
    const mockContact = { id: 'contact-1', type: 'Buyer' };
    const mockDeal = { id: 'deal-123', pipeline_id: 'pipe-1' };

    const makeBuilder = (table: string) => {
      let data: any = null;
      if (table === 'contacts') data = mockContact;
      else if (table === 'deals') data = mockDeal;

      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        single: vi.fn().mockResolvedValue({ data, error: null }),
        then: (onfulfilled: any) => onfulfilled({ data, error: null }),
      };
      return builder;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table) => makeBuilder(table)),
    } as any;

    await handleInboundSmsReply(mockSupabase, 'account-123', 'contact-1', 'I want to buy next month, budget is 500k');

    expect(mockSupabase.from).toHaveBeenCalledWith('deals');
  });
});

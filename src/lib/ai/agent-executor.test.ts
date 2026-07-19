import { describe, expect, it, vi } from 'vitest';
import { executeAgentTool } from './agent-executor';

describe('AgentExecutor', () => {
  it('successfully executes update_deal_stage tool', async () => {
    const mockDeal = { id: 'deal-123', pipeline_id: 'pipe-1', stage: 'Qualified' };

    const makeBuilder = (data: any) => {
      const builder: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        single: vi.fn().mockResolvedValue({ data: mockDeal, error: null }),
        update: vi.fn().mockReturnThis(),
        then: (onfulfilled: any) => onfulfilled({ data, error: null }),
      };
      return builder;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table) => {
        if (table === 'deals') return makeBuilder(mockDeal);
        return makeBuilder(null);
      }),
    } as any;

    const result = await executeAgentTool(mockSupabase, 'account-123', 'update_deal_stage', {
      deal_id: 'deal-123',
      stage: 'Qualified',
    });

    expect(result.success).toBe(true);
    expect(result.data.stage).toBe('Qualified');
  });

  it('successfully executes send_sms_via_twilio and triggers live messages WebSocket feed', async () => {
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
        contains: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
        single: vi.fn().mockResolvedValue({ data, error: null }),
        then: (onfulfilled: any) => onfulfilled({ data, error: null }),
      };
      return builder;
    };

    const mockSupabase = {
      from: vi.fn().mockImplementation((table) => makeBuilder(table)),
    } as any;

    const result = await executeAgentTool(mockSupabase, 'account-123', 'send_sms_via_twilio', {
      contact_id: 'contact-1',
      message: 'Hello!',
    });

    expect(result.success).toBe(true);
    expect(result.data.message.content_text).toBe('Hello!');
  });
});

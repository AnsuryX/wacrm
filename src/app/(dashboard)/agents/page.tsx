'use client';

import { useEffect, useState } from 'react';
import { Bot, Sparkles, Settings2, BarChart3 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AiPlayground } from '@/components/agents/ai-playground';
import { AiUsageCard } from '@/components/agents/ai-usage';
import { AiConfig } from '@/components/settings/ai-config';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { createClient } from '@/lib/supabase/client';

import { toast } from 'sonner';
import type { AgentPersona } from '@/types';

type Tab = 'playground' | 'personas' | 'setup' | 'usage';

export default function AgentsPage() {
  const supabase = useAuth();
  const { accountRole, accountId } = supabase;
  const canViewUsage = accountRole ? canEditSettings(accountRole) : false;
  const [tab, setTab] = useState<Tab>('playground');
  const [decided, setDecided] = useState(false);
  const [personas, setPersonas] = useState<AgentPersona[]>([]);
  const [loadingPersonas, setLoadingPersonas] = useState(false);

  // Fetch personas for the account
  const fetchPersonas = async () => {
    if (!accountId) return;
    setLoadingPersonas(true);
    try {
      const res = await fetch('/api/v1/ai/personas', {
        headers: {
          'Authorization': `Bearer ` // using browser session cookie implicitly or key
        }
      });
      if (res.ok) {
        const body = await res.json();
        if (body.data) {
          setPersonas(body.data as AgentPersona[]);
        }
      }
    } catch (err) {
      console.error(err);
    }
    setLoadingPersonas(false);
  };

  useEffect(() => {
    if (tab === 'personas') {
      fetchPersonas();
    }
  }, [tab, accountId]);

  const togglePersonaActive = async (id: string, currentActive: boolean) => {
    const nextActive = !currentActive;
    // Optimistic update
    setPersonas((prev) =>
      prev.map((p) => (p.id === id ? { ...p, active: nextActive } : p))
    );

    const client = createClient();
    const { error } = await client
      .from('agent_personas')
      .update({ active: nextActive })
      .eq('id', id);

    if (error) {
      toast.error('Failed to update persona status.');
      fetchPersonas();
    } else {
      toast.success(`Persona is now ${nextActive ? 'active' : 'inactive'}.`);
    }
  };

  // Land first-time users on Setup, returning users on the Playground.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/config');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setTab(data?.configured ? 'playground' : 'setup');
      } catch {
        if (!cancelled) setTab('setup');
      } finally {
        if (!cancelled) setDecided(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Bot className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          AI Agents
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Your bring-your-own-key AI agent — set it up, then test it in the
        playground before it replies to customers in the inbox.
      </p>

      {decided && (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="mt-6"
        >
          <TabsList>
            <TabsTrigger value="playground">
              <Sparkles className="mr-1.5 h-4 w-4" /> Playground
            </TabsTrigger>
            <TabsTrigger value="personas">
              <Bot className="mr-1.5 h-4 w-4" /> Personas
            </TabsTrigger>
            <TabsTrigger value="setup">
              <Settings2 className="mr-1.5 h-4 w-4" /> Setup
            </TabsTrigger>
            {canViewUsage && (
              <TabsTrigger value="usage">
                <BarChart3 className="mr-1.5 h-4 w-4" /> Usage
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="playground" className="mt-4">
            <AiPlayground onGoToSetup={() => setTab('setup')} />
          </TabsContent>

          <TabsContent value="personas" className="mt-4">
            {loadingPersonas ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {personas.map((persona) => (
                  <div
                    key={persona.id}
                    className={`rounded-xl border p-4 bg-card shadow-sm transition-all ${
                      persona.active ? 'border-primary/40 ring-1 ring-primary/10' : 'border-border opacity-70'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary text-base font-bold">
                        {persona.name.charAt(0)}
                      </div>
                      <span className="rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-bold text-primary uppercase">
                        {persona.specialty_badge}
                      </span>
                    </div>

                    <h3 className="mt-3 font-semibold text-foreground text-sm">
                      {persona.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 font-medium">{persona.role}</p>

                    <div className="mt-3 space-y-2 text-xs">
                      <div>
                        <span className="font-semibold text-muted-foreground block text-[10px] uppercase">Base Tone:</span>
                        <p className="text-foreground italic mt-0.5 line-clamp-2">"{persona.tone}"</p>
                      </div>

                      {persona.connected_capabilities && persona.connected_capabilities.length > 0 && (
                        <div>
                          <span className="font-semibold text-muted-foreground block text-[10px] uppercase">Connected Capabilities:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {persona.connected_capabilities.map((cap) => (
                              <span key={cap} className="bg-muted px-1.5 py-0.5 rounded text-[9px] font-bold text-foreground">
                                {cap}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                      <span className="text-xs text-muted-foreground font-semibold">Active Status</span>
                      <button
                        onClick={() => togglePersonaActive(persona.id, persona.active)}
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold transition-all ${
                          persona.active
                            ? 'bg-green-500/15 text-green-400 border border-green-500/20'
                            : 'bg-muted text-muted-foreground border border-border'
                        }`}
                      >
                        {persona.active ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="setup" className="mt-4">
            <AiConfig />
          </TabsContent>

          {canViewUsage && (
            <TabsContent value="usage" className="mt-4">
              <AiUsageCard />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
}

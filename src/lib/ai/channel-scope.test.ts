import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { loadAiConfig } from './config';

// ------------------------------------------------------------
// Agente de IA POR CANAL.
//
// Até a 903, `ai_configs.account_id` era UNIQUE: existia UM único agente por
// conta. O bot se apresentava com o discurso comercial respondendo quem
// escreveu no número do jurídico, e não havia como diferenciar tom, regras ou
// modelo por departamento.
// ------------------------------------------------------------

interface Linhas {
  porCanal?: Record<string, unknown> | null;
  padrao?: Record<string, unknown> | null;
  erroCanal?: { message: string } | null;
}

function makeDb(linhas: Linhas): SupabaseClient {
  let filtrouCanal = false;
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string) => {
      if (col === 'channel_id') filtrouCanal = true;
      return builder;
    },
    is: () => builder,
    maybeSingle: () => {
      const resposta = filtrouCanal
        ? { data: linhas.porCanal ?? null, error: linhas.erroCanal ?? null }
        : { data: linhas.padrao ?? null, error: null };
      filtrouCanal = false;
      return Promise.resolve(resposta);
    },
  };
  return {
    from: () => {
      filtrouCanal = false;
      return builder;
    },
  } as unknown as SupabaseClient;
}

const LINHA = {
  provider: 'anthropic',
  model: 'claude-x',
  api_key: 'aa:bb:cc',
  system_prompt: 'padrão',
  is_active: true,
  auto_reply_enabled: true,
  auto_reply_max_per_conversation: 3,
  handoff_agent_id: null,
  embeddings_api_key: null,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// decrypt real quebraria no formato falso; basta o shape passar.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `dec(${v})`,
}));

describe('loadAiConfig — agente por canal', () => {
  it('usa o agente DO CANAL quando existe', async () => {
    const db = makeDb({
      porCanal: { ...LINHA, system_prompt: 'jurídico' },
      padrao: { ...LINHA, system_prompt: 'comercial' },
    });
    const cfg = await loadAiConfig(db, 'acct', { channelId: 'ch-jur' });
    expect(cfg?.systemPrompt).toBe('jurídico');
  });

  it('cai no agente PADRÃO quando o canal não tem o seu', async () => {
    const db = makeDb({ porCanal: null, padrao: { ...LINHA, system_prompt: 'comercial' } });
    const cfg = await loadAiConfig(db, 'acct', { channelId: 'ch-sem-agente' });
    expect(cfg?.systemPrompt).toBe('comercial');
  });

  it('agente do canal DESLIGADO cala a IA — não reabre pelo padrão', async () => {
    // Cair no padrão aqui reabriria exatamente o que o operador desligou
    // naquele número.
    const db = makeDb({
      porCanal: { ...LINHA, is_active: false },
      padrao: { ...LINHA, system_prompt: 'comercial' },
    });
    expect(await loadAiConfig(db, 'acct', { channelId: 'ch-jur' })).toBeNull();
  });

  it('erro na consulta por canal (deploy pré-903) cai no padrão em vez de derrubar a IA', async () => {
    const db = makeDb({
      erroCanal: { message: 'column "channel_id" does not exist' },
      padrao: { ...LINHA, system_prompt: 'comercial' },
    });
    const cfg = await loadAiConfig(db, 'acct', { channelId: 'ch-jur' });
    expect(cfg?.systemPrompt).toBe('comercial');
  });

  it('sem channelId lê apenas o agente padrão (comportamento de antes)', async () => {
    const db = makeDb({
      porCanal: { ...LINHA, system_prompt: 'NÃO deveria ser lido' },
      padrao: { ...LINHA, system_prompt: 'comercial' },
    });
    const cfg = await loadAiConfig(db, 'acct');
    expect(cfg?.systemPrompt).toBe('comercial');
  });
});

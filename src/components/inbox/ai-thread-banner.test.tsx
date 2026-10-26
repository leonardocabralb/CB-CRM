import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';
import { MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE } from '@/lib/ia-agentes/quem-responde';

import {
  AiThreadBanner,
  erroDaResposta,
  FaixaDaIa,
  faixaDaIa,
  lerEstadoDaIa,
  MOTIVOS_DA_PAUSA,
  type EstadoDaIa,
  type ErroDaFaixa,
  type Faixa,
} from './ai-thread-banner';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ============================================================
// A faixa do agente de IA no fio (D24–D26 do docs/PLANO-agentes-de-ia.md):
//   - atendendo → "IA · <nome> responde nesta conversa" + Pausar;
//   - pausada   → "IA pausada — <motivo>" + Retomar IA;
//   - nada      → não aparece.
// Quem responde é o agente da ETAPA do card, que só a rota
// `GET /api/cb/ia/conversa/[id]` sabe; a conversa guarda só a pausa e o
// último agente que respondeu.
// ============================================================

const banner = ptBR.Inbox.aiBanner;
const TRIAGEM = { id: 'ag-1', nome: 'Triagem' };

function estado(p: Partial<EstadoDaIa> = {}): EstadoDaIa {
  return { agente: TRIAGEM, pausada: false, pausadaPor: null, naoAtende: null, ...p };
}

const CARD_ANTIGO = { agente: TRIAGEM, motivo: 'card_antigo' } as const;

function desenhar(faixa: Faixa, messages: AbstractIntlMessages = ptBR as unknown as AbstractIntlMessages) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <FaixaDaIa faixa={faixa} busy={false} aoPausar={() => {}} aoRetomar={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe('faixaDaIa — o que a faixa desenha', () => {
  it('agente da etapa atende e não há pausa: "atendendo", com o nome', () => {
    expect(faixaDaIa(estado(), null)).toEqual({ tipo: 'atendendo', agente: 'Triagem' });
  });

  it('nenhum agente atende e não há pausa: não desenha', () => {
    expect(faixaDaIa(estado({ agente: null }), 'ag-1')).toBeNull();
    expect(faixaDaIa(estado({ agente: null }), null)).toBeNull();
  });

  it('pausada com agente: "pausada", com o motivo', () => {
    for (const m of MOTIVOS_DA_PAUSA) {
      expect(faixaDaIa(estado({ pausada: true, pausadaPor: m }), null)).toEqual({
        tipo: 'pausada',
        motivo: m,
        naoAtende: null,
      });
    }
  });

  it('⚠️ D26: pausada continua aparecendo quando o card saiu da etapa do agente (o último que respondeu basta)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente' }), 'ag-1')).toEqual({
      tipo: 'pausada',
      motivo: 'gente',
      naoAtende: null,
    });
  });

  it('pausa antiga numa conversa que nenhum agente atende nem atendeu: não desenha (Retomar não retomaria nada)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: null }), null)).toBeNull();
  });

  it('motivo desconhecido ou nulo: pausada, sem motivo', () => {
    expect(faixaDaIa(estado({ pausada: true, pausadaPor: 'outro' }), null)).toEqual({
      tipo: 'pausada',
      motivo: null,
      naoAtende: null,
    });
    expect(faixaDaIa(estado({ pausada: true }), null)).toEqual({ tipo: 'pausada', motivo: null, naoAtende: null });
  });

  it('sem resposta da rota (carregando, falhou, outra conversa): não desenha', () => {
    expect(faixaDaIa(null, 'ag-1')).toBeNull();
  });
});

describe('faixaDaIa — "não atende": a etapa TEM agente, mas ele não atende (validação de 25/10/2026)', () => {
  it('⚠️ card antigo depois de religar o agente: a linha aparece onde antes não se desenhava NADA', () => {
    expect(faixaDaIa(estado({ agente: null, naoAtende: CARD_ANTIGO }), null)).toEqual({
      tipo: 'naoAtende',
      agente: 'Triagem',
      motivo: 'card_antigo',
    });
    // Com o último agente que respondeu na conversa, também (sem pausa não há Retomar a oferecer).
    expect(faixaDaIa(estado({ agente: null, naoAtende: CARD_ANTIGO }), 'ag-1')).toMatchObject({ tipo: 'naoAtende' });
  });

  it('cada motivo da lista do motor chega à faixa', () => {
    for (const motivo of MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE) {
      expect(faixaDaIa(estado({ agente: null, naoAtende: { agente: TRIAGEM, motivo } }), null)).toEqual({
        tipo: 'naoAtende',
        agente: 'Triagem',
        motivo,
      });
    }
  });

  it('os estados de hoje ficam: pausada com agente segue pausada + Retomar, e ganha a linha embaixo', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente', naoAtende: CARD_ANTIGO }), 'ag-1')).toEqual({
      tipo: 'pausada',
      motivo: 'gente',
      naoAtende: { agente: 'Triagem', motivo: 'card_antigo' },
    });
  });

  it('pausada sem agente nenhum a retomar, mas com o da etapa que não atende: só a linha (sem Retomar)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente', naoAtende: CARD_ANTIGO }), null)).toEqual({
      tipo: 'naoAtende',
      agente: 'Triagem',
      motivo: 'card_antigo',
    });
  });

  it('sem `naoAtende` e sem agente: continua não desenhando', () => {
    expect(faixaDaIa(estado({ agente: null }), null)).toBeNull();
  });
});

describe('lerEstadoDaIa — o corpo da rota', () => {
  it('lê o agente, a pausa e o motivo', () => {
    expect(lerEstadoDaIa({ agente: TRIAGEM, pausada: true, pausadaPor: 'botao', motivo: null })).toEqual({
      agente: TRIAGEM,
      pausada: true,
      pausadaPor: 'botao',
      naoAtende: null,
    });
  });
  it('forma estranha: agente nulo, pausa só com o booleano true', () => {
    expect(lerEstadoDaIa({ agente: { id: 1 }, pausada: 'true' })).toEqual({
      agente: null,
      pausada: false,
      pausadaPor: null,
      naoAtende: null,
    });
    expect(lerEstadoDaIa(null)).toBeNull();
  });
  it('lê `naoAtende`; motivo fora da lista ou agente sem nome = nulo (nunca chave crua na tela)', () => {
    expect(lerEstadoDaIa({ agente: null, pausada: false, naoAtende: CARD_ANTIGO })?.naoAtende).toEqual(CARD_ANTIGO);
    expect(lerEstadoDaIa({ naoAtende: { agente: TRIAGEM, motivo: 'motivo_novo' } })?.naoAtende).toBeNull();
    expect(lerEstadoDaIa({ naoAtende: { agente: { id: 'ag-1' }, motivo: 'card_antigo' } })?.naoAtende).toBeNull();
    expect(lerEstadoDaIa({ naoAtende: 'card_antigo' })?.naoAtende).toBeNull();
  });
});

describe('FaixaDaIa — o texto, nos dois dicionários', () => {
  it('atendendo: "IA · Triagem responde nesta conversa" e Pausar', () => {
    const html = desenhar({ tipo: 'atendendo', agente: 'Triagem' });
    expect(html).toContain('IA · Triagem responde nesta conversa');
    expect(html).toContain(banner.pausar);
    expect(html).not.toContain(banner.resume);
  });

  it.each(MOTIVOS_DA_PAUSA)('pausada por %s: "IA pausada — <motivo>" e Retomar IA', (motivo) => {
    const html = desenhar({ tipo: 'pausada', motivo, naoAtende: null });
    expect(html).toContain(`IA pausada — ${banner.motivo[motivo]}`);
    expect(html).toContain(banner.resume);
    expect(html).not.toContain(banner.pausar);
  });

  it('pausada sem motivo: só "IA pausada"', () => {
    const html = desenhar({ tipo: 'pausada', motivo: null, naoAtende: null });
    expect(html).toContain(`>${banner.pausada}<`);
  });

  it('⚠️ não atende, card antigo: "IA · Triagem não atende esta conversa: <motivo>", a dica, e nenhum botão', () => {
    const html = desenhar({ tipo: 'naoAtende', agente: 'Triagem', motivo: 'card_antigo' });
    expect(html).toContain(
      `IA · Triagem não atende esta conversa: ${banner.naoAtendeMotivo.card_antigo}`,
    );
    expect(html).toContain(banner.naoAtendeDica);
    expect(html).not.toContain('<button');
  });

  it('não atende por agente desligado ou fora da conexão: o motivo, sem a dica do card antigo', () => {
    for (const motivo of ['agente_desligado', 'fora_da_conexao'] as const) {
      const html = desenhar({ tipo: 'naoAtende', agente: 'Triagem', motivo });
      expect(html).toContain(`IA · Triagem não atende esta conversa: ${banner.naoAtendeMotivo[motivo]}`);
      expect(html).not.toContain(banner.naoAtendeDica);
    }
  });

  it('pausada com a linha "não atende" embaixo: Retomar continua, e a linha diz que ele ainda não atenderia', () => {
    const html = desenhar({ tipo: 'pausada', motivo: 'gente', naoAtende: { agente: 'Triagem', motivo: 'card_antigo' } });
    expect(html).toContain(`IA pausada — ${banner.motivo.gente}`);
    expect(html).toContain(banner.resume);
    expect(html).toContain(banner.naoAtendeMotivo.card_antigo);
  });

  it('⚠️ o motivo do "não atende" é chave MONTADA: cada um da lista do motor existe nos DOIS dicionários', () => {
    for (const dic of [en, ptBR]) {
      const b = dic.Inbox.aiBanner as Record<string, unknown> & { naoAtendeMotivo?: Record<string, unknown> };
      expect(typeof b.naoAtende, 'Inbox.aiBanner.naoAtende').toBe('string');
      expect(typeof b.naoAtendeDica, 'Inbox.aiBanner.naoAtendeDica').toBe('string');
      for (const m of MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE) {
        expect(typeof b.naoAtendeMotivo?.[m], `Inbox.aiBanner.naoAtendeMotivo.${m}`).toBe('string');
      }
    }
  });

  it('não atende em inglês também, sem chave crua', () => {
    for (const motivo of MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE) {
      const html = desenhar({ tipo: 'naoAtende', agente: 'Triagem', motivo }, en as unknown as AbstractIntlMessages);
      expect(html).not.toContain('Inbox.aiBanner');
      expect(html).toContain('Triagem');
    }
  });

  it('nada: não desenha', () => {
    expect(desenhar(null)).toBe('');
  });

  it('⚠️ o motivo é chave MONTADA: cada um existe nos DOIS dicionários', () => {
    for (const dic of [en, ptBR]) {
      for (const m of MOTIVOS_DA_PAUSA) {
        expect(typeof dic.Inbox.aiBanner.motivo[m], `Inbox.aiBanner.motivo.${m}`).toBe('string');
      }
    }
  });

  it('desenha em inglês também, sem chave crua', () => {
    const html = desenhar({ tipo: 'pausada', motivo: 'gente', naoAtende: null }, en as unknown as AbstractIntlMessages);
    expect(html).toContain(en.Inbox.aiBanner.motivo.gente);
    expect(html).not.toContain('Inbox.aiBanner');
  });
});

describe('AiThreadBanner — antes da resposta da rota não desenha nada', () => {
  it('primeiro render (a rota ainda não respondeu): vazio — nunca o estado de outra conversa', () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="pt-BR" messages={ptBR as unknown as AbstractIntlMessages} timeZone="America/Sao_Paulo">
        <AiThreadBanner conversationId="conv-1" iaAgenteId="ag-1" disabled pausadaPor="gente" />
      </NextIntlClientProvider>,
    );
    expect(html).toBe('');
  });
});

describe('erroDaResposta — a recusa da rota vira frase do dicionário', () => {
  it.each<[number, unknown, ErroDaFaixa]>([
    [400, 'grupo', 'grupo'],
    [400, 'instagram', 'instagram'],
    [409, 'nada_gravado', 'nadaGravado'],
    [404, undefined, 'naoEncontrada'],
    [403, undefined, 'semPermissao'],
    [429, undefined, 'muitasTentativas'],
    [500, undefined, 'generico'],
    [401, undefined, 'generico'],
    [400, undefined, 'generico'],
  ])('%i + %s → %s', (status, code, esperado) => {
    expect(erroDaResposta(status, code)).toBe(esperado);
  });

  it('toda frase de erro existe nos DOIS dicionários', () => {
    const chaves = [
      'erroGrupo',
      'erroInstagram',
      'erroNadaGravado',
      'erroNaoEncontrada',
      'erroSemPermissao',
      'erroMuitasTentativas',
      'updateError',
      'networkError',
      'pausou',
      'resumed',
      'retomarDica',
    ] as const;
    for (const dic of [en, ptBR]) {
      for (const c of chaves) {
        expect(typeof dic.Inbox.aiBanner[c], `Inbox.aiBanner.${c}`).toBe('string');
      }
    }
  });
});

describe('pino estrutural do fonte da faixa', () => {
  const fonte = readFileSync(join(__dirname, 'ai-thread-banner.tsx'), 'utf8')
    // Sem comentários: o cabeçalho descreve a versão antiga por extenso.
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('pergunta à rota da conversa quem responde (o agente é o da ETAPA, D24)', () => {
    expect(fonte).toContain('/api/cb/ia/conversa/');
  });

  it('não pergunta à configuração legada se a IA está ligada', () => {
    expect(fonte).not.toContain('/api/ai/config');
    expect(fonte).not.toContain('auto_reply_enabled');
    expect(fonte).not.toContain('is_active');
  });

  it('Pausar não atribui a conversa a ninguém (o "Assumir" saiu)', () => {
    expect(fonte).toContain('JSON.stringify({ paused: pausar })');
    expect(fonte).not.toContain('assign_to_me');
  });

  it('o toast de erro nunca mostra o `error` cru da rota (inglês)', () => {
    expect(fonte).not.toMatch(/\.error\s*\?\?/);
    expect(fonte).not.toMatch(/toast\.error\(\s*j\b/);
  });

  it('o responsável humano não esconde a faixa', () => {
    expect(fonte).not.toMatch(/assignedAgentId/);
  });
});

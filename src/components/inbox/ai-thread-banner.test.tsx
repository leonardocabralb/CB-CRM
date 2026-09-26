import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

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
  return { agente: TRIAGEM, pausada: false, pausadaPor: null, ...p };
}

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
      expect(faixaDaIa(estado({ pausada: true, pausadaPor: m }), null)).toEqual({ tipo: 'pausada', motivo: m });
    }
  });

  it('⚠️ D26: pausada continua aparecendo quando o card saiu da etapa do agente (o último que respondeu basta)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: 'gente' }), 'ag-1')).toEqual({
      tipo: 'pausada',
      motivo: 'gente',
    });
  });

  it('pausa antiga numa conversa que nenhum agente atende nem atendeu: não desenha (Retomar não retomaria nada)', () => {
    expect(faixaDaIa(estado({ agente: null, pausada: true, pausadaPor: null }), null)).toBeNull();
  });

  it('motivo desconhecido ou nulo: pausada, sem motivo', () => {
    expect(faixaDaIa(estado({ pausada: true, pausadaPor: 'outro' }), null)).toEqual({ tipo: 'pausada', motivo: null });
    expect(faixaDaIa(estado({ pausada: true }), null)).toEqual({ tipo: 'pausada', motivo: null });
  });

  it('sem resposta da rota (carregando, falhou, outra conversa): não desenha', () => {
    expect(faixaDaIa(null, 'ag-1')).toBeNull();
  });
});

describe('lerEstadoDaIa — o corpo da rota', () => {
  it('lê o agente, a pausa e o motivo', () => {
    expect(lerEstadoDaIa({ agente: TRIAGEM, pausada: true, pausadaPor: 'botao', motivo: null })).toEqual({
      agente: TRIAGEM,
      pausada: true,
      pausadaPor: 'botao',
    });
  });
  it('forma estranha: agente nulo, pausa só com o booleano true', () => {
    expect(lerEstadoDaIa({ agente: { id: 1 }, pausada: 'true' })).toEqual({
      agente: null,
      pausada: false,
      pausadaPor: null,
    });
    expect(lerEstadoDaIa(null)).toBeNull();
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
    const html = desenhar({ tipo: 'pausada', motivo });
    expect(html).toContain(`IA pausada — ${banner.motivo[motivo]}`);
    expect(html).toContain(banner.resume);
    expect(html).not.toContain(banner.pausar);
  });

  it('pausada sem motivo: só "IA pausada"', () => {
    const html = desenhar({ tipo: 'pausada', motivo: null });
    expect(html).toContain(`>${banner.pausada}<`);
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
    const html = desenhar({ tipo: 'pausada', motivo: 'gente' }, en as unknown as AbstractIntlMessages);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

import {
  AiThreadBanner,
  erroDaResposta,
  patchDoClique,
  pausadaNaTela,
  type ErroDaFaixa,
} from './ai-thread-banner';

// ============================================================
// A faixa do agente de IA no fio (F2a dos agentes de IA, 5.3/5.4/5.9 e
// E2/E13 do docs/PLANO-agentes-de-ia.md). Três coisas que já mentiram:
//   1. ela se acendia pela configuração LEGADA (`is_active` +
//      `auto_reply_enabled`), e não pelo agente ativo da CONVERSA;
//   2. ela se escondia com responsável humano — a atribuição deixou de ser
//      portão (o responsável não cala o agente ativo);
//   3. "Retomar" zerava `assigned_agent_id` na tela, e a rota não zera mais.
// ============================================================

const pt = ptBR as unknown as AbstractIntlMessages;

function desenhar(
  props: Partial<Parameters<typeof AiThreadBanner>[0]> = {},
  messages: AbstractIntlMessages = pt,
) {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <AiThreadBanner
        conversationId="conv-1"
        iaAgenteId="agente-1"
        disabled={false}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const banner = ptBR.Inbox.aiBanner;

describe('AiThreadBanner — acende pela conversa', () => {
  it('sem agente ativo, não desenha nada — nem com a IA pausada', () => {
    expect(desenhar({ iaAgenteId: null })).toBe('');
    expect(desenhar({ iaAgenteId: null, disabled: true, pausadaPor: 'botao' })).toBe('');
  });

  it('com agente ativo e sem pausa: "respondendo" e Assumir, já no primeiro render', () => {
    const html = desenhar();
    expect(html).toContain(banner.activeText);
    expect(html).toContain(banner.takeOver);
    expect(html).not.toContain(banner.resume);
  });

  it('com agente ativo e pausada: o título da pausa e Retomar', () => {
    const html = desenhar({ disabled: true });
    expect(html).toContain(banner.pausedTitle);
    expect(html).toContain(banner.resume);
    expect(html).not.toContain(banner.activeText);
  });

  it.each([
    ['gente', banner.pausadaPorGente],
    ['transferencia', banner.pausadaPorTransferencia],
    ['botao', banner.pausadaPeloBotao],
    ['automacao', banner.pausadaPorAutomacao],
  ])('pausa por %s: diz o motivo', (motivo, texto) => {
    expect(desenhar({ disabled: true, pausadaPor: motivo })).toContain(texto);
  });

  it('pausa sem motivo (anterior à 1044) ou com motivo desconhecido: só o título', () => {
    const motivos = [
      banner.pausadaPorGente,
      banner.pausadaPorTransferencia,
      banner.pausadaPeloBotao,
      banner.pausadaPorAutomacao,
    ];
    for (const pausadaPor of [null, 'outro']) {
      const html = desenhar({ disabled: true, pausadaPor });
      expect(html).toContain(banner.pausedTitle);
      for (const m of motivos) expect(html).not.toContain(m);
    }
  });

  it('desenha em inglês também, sem chave crua', () => {
    const html = desenhar(
      { disabled: true, pausadaPor: 'gente' },
      en as unknown as AbstractIntlMessages,
    );
    expect(html).toContain(en.Inbox.aiBanner.pausedTitle);
    expect(html).toContain(en.Inbox.aiBanner.pausadaPorGente);
    expect(html).not.toContain('Inbox.aiBanner');
  });
});

describe('patchDoClique — o que a tela escreve depois do clique', () => {
  it('⚠️ Retomar NÃO menciona o responsável (a rota não o zera mais, E13)', () => {
    const patch = patchDoClique(false, 'user-1');
    expect(patch).toEqual({ ai_autoreply_disabled: false });
    expect('assigned_agent_id' in patch).toBe(false);
  });

  it('Assumir pausa e atribui a quem clicou (a rota faz o mesmo com assign_to_me)', () => {
    expect(patchDoClique(true, 'user-1')).toEqual({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'user-1',
    });
  });

  it('Assumir sem saber quem clicou só pausa — nunca atribui a ninguém', () => {
    const patch = patchDoClique(true, null);
    expect(patch).toEqual({ ai_autoreply_disabled: true });
    expect('assigned_agent_id' in patch).toBe(false);
  });
});

describe('pausadaNaTela — clique otimista, derivado no render', () => {
  it('sem clique, vale o banco', () => {
    expect(pausadaNaTela(null, 'conv-1', true)).toBe(true);
    expect(pausadaNaTela(null, 'conv-1', false)).toBe(false);
  });

  it('o clique vale enquanto o banco ainda diz o que dizia', () => {
    expect(pausadaNaTela({ conversa: 'conv-1', base: true, pausada: false }, 'conv-1', true)).toBe(false);
  });

  it('o clique de OUTRA conversa não vale nesta', () => {
    expect(pausadaNaTela({ conversa: 'conv-1', base: true, pausada: false }, 'conv-2', true)).toBe(true);
  });

  it('o banco mudou depois do clique (realtime, ou o gatilho da 1044 pausou): manda o banco', () => {
    // Retomou (base = pausada), o realtime confirmou e depois o advogado
    // respondeu pelo celular: o banco voltou a dizer "pausada".
    expect(pausadaNaTela({ conversa: 'conv-1', base: true, pausada: false }, 'conv-1', false)).toBe(false);
    expect(pausadaNaTela({ conversa: 'conv-1', base: false, pausada: true }, 'conv-1', true)).toBe(true);
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

  it('não pergunta à configuração legada se a IA está ligada', () => {
    expect(fonte).not.toContain('/api/ai/config');
    expect(fonte).not.toContain('auto_reply_enabled');
    expect(fonte).not.toContain('is_active');
  });

  it('o toast de erro nunca mostra o `error` cru da rota (inglês)', () => {
    expect(fonte).not.toMatch(/\.error\s*\?\?/);
    expect(fonte).not.toMatch(/toast\.error\(\s*j\b/);
  });

  it('o responsável humano não esconde a faixa', () => {
    expect(fonte).not.toMatch(/assignedAgentId/);
  });
});

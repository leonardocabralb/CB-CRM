import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';

import en from '../../../messages/en.json';
import ptBR from '../../../messages/pt-BR.json';

import {
  AiThreadBanner,
  cliqueAindaVale,
  erroDaResposta,
  patchDoClique,
  pausadaNaTela,
  type CliqueOtimista,
  type ErroDaFaixa,
} from './ai-thread-banner';

// ------------------------------------------------------------
// Estado ENTRE renders, sem DOM. O projeto não tem jsdom, e o
// `renderToStaticMarkup` esquece o estado a cada chamada — e o defeito do
// clique otimista só aparece numa SEQUÊNCIA de renders (o banco sai do valor
// do clique e depois volta). Ligado, este arnês troca o `useState` e o
// `useCallback` DA FAIXA (só dela: o `next-intl` e o `react-dom` são externos
// e seguem com o React de verdade) por um armazém por ordem de chamada, que
// sobrevive aos renders, e guarda os callbacks do último render — é por eles
// que o teste "clica". Um `setState` no render muda o armazém e o render
// segue com o valor velho, como o React faria antes de refazer o render.
// Desligado, delega ao React.
// ------------------------------------------------------------
const ganchos = vi.hoisted(() => ({
  ligado: false,
  estados: [] as unknown[],
  proximo: 0,
  callbacks: [] as unknown[],
}));

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>();
  const useState = (inicial: unknown) => {
    if (!ganchos.ligado) return real.useState(inicial);
    const i = ganchos.proximo++;
    if (!(i in ganchos.estados)) {
      ganchos.estados[i] = typeof inicial === 'function' ? (inicial as () => unknown)() : inicial;
    }
    const definir = (valor: unknown) => {
      ganchos.estados[i] =
        typeof valor === 'function' ? (valor as (v: unknown) => unknown)(ganchos.estados[i]) : valor;
    };
    return [ganchos.estados[i], definir];
  };
  const useCallback = (fn: unknown, deps: unknown[]) => {
    if (!ganchos.ligado) return real.useCallback(fn as () => void, deps);
    ganchos.callbacks.push(fn);
    return fn;
  };
  return {
    ...real,
    useState: useState as unknown as typeof real.useState,
    useCallback: useCallback as unknown as typeof real.useCallback,
  };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// ============================================================
// A faixa do agente de IA no fio (F2a dos agentes de IA, 5.3/5.4/5.9 e
// E2/E13 do docs/PLANO-agentes-de-ia.md). Quatro coisas que já mentiram:
//   1. ela se acendia pela configuração LEGADA (`is_active` +
//      `auto_reply_enabled`), e não pelo agente ativo da CONVERSA;
//   2. ela se escondia com responsável humano — a atribuição deixou de ser
//      portão (o responsável não cala o agente ativo);
//   3. "Retomar" zerava `assigned_agent_id` na tela, e a rota não zera mais;
//   4. o clique otimista nunca era apagado: o banco confirmava, depois VOLTAVA
//      ao valor antigo (o gatilho pausou, outra aba retomou), e o clique velho
//      voltava a mandar na tela até recarregar a página.
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

  it('pausa sem motivo (anterior à 1049) ou com motivo desconhecido: só o título', () => {
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

describe('pausadaNaTela / cliqueAindaVale — o clique otimista num render', () => {
  const retomou: CliqueOtimista = { conversa: 'conv-1', base: true, pausada: false };

  it('sem clique, vale o banco', () => {
    expect(pausadaNaTela(null, 'conv-1', true)).toBe(true);
    expect(pausadaNaTela(null, 'conv-1', false)).toBe(false);
  });

  it('o clique aceito vale enquanto o banco ainda diz o que dizia', () => {
    expect(cliqueAindaVale(retomou, 'conv-1', true)).toBe(true);
    expect(pausadaNaTela(retomou, 'conv-1', true)).toBe(false);
  });

  it('o clique que a rota ainda não respondeu não muda a tela', () => {
    const pendente: CliqueOtimista = { ...retomou, pausada: null };
    expect(cliqueAindaVale(pendente, 'conv-1', true)).toBe(true);
    expect(pausadaNaTela(pendente, 'conv-1', true)).toBe(true);
  });

  it('o clique de OUTRA conversa não vale nesta', () => {
    expect(cliqueAindaVale(retomou, 'conv-2', true)).toBe(false);
    expect(pausadaNaTela(retomou, 'conv-2', true)).toBe(true);
  });

  it('o banco saiu do valor do clique (realtime, gatilho da 1049, outra aba): o clique deixa de valer', () => {
    // Num render só, olhando o valor, este é o passo B do A→B→A. O passo de
    // VOLTA (o banco de novo em A) só se enxerga com o estado entre renders —
    // é o describe seguinte que o cobre.
    expect(cliqueAindaVale(retomou, 'conv-1', false)).toBe(false);
    expect(pausadaNaTela(retomou, 'conv-1', false)).toBe(false);
    const assumiu: CliqueOtimista = { conversa: 'conv-1', base: false, pausada: true };
    expect(pausadaNaTela(assumiu, 'conv-1', true)).toBe(true);
  });
});

describe('a faixa numa SEQUÊNCIA de renders — o clique velho nunca volta a mandar', () => {
  type Props = Partial<Parameters<typeof AiThreadBanner>[0]>;

  function renderizar(props: Props) {
    ganchos.proximo = 0;
    ganchos.callbacks = [];
    return desenhar(props);
  }

  function estado(html: string): 'pausada' | 'respondendo' {
    const pausada = html.includes(banner.pausedTitle);
    const respondendo = html.includes(banner.activeText);
    expect(pausada !== respondendo, 'a faixa desenha exatamente um dos dois').toBe(true);
    return pausada ? 'pausada' : 'respondendo';
  }

  /** O "clique" no botão do último render. */
  function clicar(pausar: boolean): Promise<void> {
    const assincronos = ganchos.callbacks.filter(
      (f): f is (p: boolean) => Promise<void> =>
        typeof f === 'function' && f.constructor.name === 'AsyncFunction',
    );
    expect(assincronos, 'a faixa tem UM handler de clique assíncrono').toHaveLength(1);
    return assincronos[0](pausar);
  }

  function respostaOk() {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  beforeEach(() => {
    ganchos.ligado = true;
    ganchos.estados = [];
    vi.stubGlobal('fetch', vi.fn(async () => respostaOk()));
  });

  afterEach(() => {
    ganchos.ligado = false;
    vi.unstubAllGlobals();
  });

  it('Retomar vale até o realtime confirmar — e a confirmação mantém a tela', async () => {
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');
    await clicar(false);
    expect(estado(renderizar({ disabled: true }))).toBe('respondendo');
    expect(estado(renderizar({ disabled: false }))).toBe('respondendo');
  });

  it('⚠️ A→B→A depois do Retomar: o gatilho pausou de novo (advogado respondeu) e a faixa diz PAUSADA', async () => {
    renderizar({ disabled: true });
    await clicar(false);
    expect(estado(renderizar({ disabled: true }))).toBe('respondendo');
    expect(estado(renderizar({ disabled: false }))).toBe('respondendo'); // realtime confirmou
    expect(estado(renderizar({ disabled: true }))).toBe('pausada'); // o gatilho da 1049
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');
  });

  it('⚠️ A→B→A depois do Assumir: outra aba retomou e a faixa diz RESPONDENDO', async () => {
    renderizar({ disabled: false });
    await clicar(true);
    expect(estado(renderizar({ disabled: false }))).toBe('pausada');
    expect(estado(renderizar({ disabled: true }))).toBe('pausada'); // realtime confirmou
    expect(estado(renderizar({ disabled: false }))).toBe('respondendo'); // outra aba retomou
  });

  it('⚠️ trocar de conversa descarta o clique: na volta, manda o banco daquela conversa', async () => {
    renderizar({ conversationId: 'conv-1', disabled: true });
    await clicar(false);
    expect(estado(renderizar({ conversationId: 'conv-1', disabled: true }))).toBe('respondendo');
    // Foi para outra conversa, pausada. Enquanto isso, na conv-1, o realtime
    // confirmou a retomada e o advogado respondeu: pausada de novo — a faixa,
    // que não remonta, não viu nada disso.
    expect(estado(renderizar({ conversationId: 'conv-2', disabled: true }))).toBe('pausada');
    expect(estado(renderizar({ conversationId: 'conv-1', disabled: true }))).toBe('pausada');
  });

  it('⚠️ o banco anda E volta enquanto a rota responde: a resposta não instala o clique', async () => {
    let responder: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((r) => (responder = r))),
    );
    renderizar({ disabled: true });
    const clique = clicar(false);
    // Enquanto a rota não responde, a tela mostra o banco.
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');
    // O realtime chega ANTES do HTTP, e o advogado responde logo em seguida.
    expect(estado(renderizar({ disabled: false }))).toBe('respondendo');
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');
    responder(respostaOk());
    await clique;
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');
  });

  it('a rota recusou, ou a rede caiu: a tela fica com o banco', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ code: 'nada_gravado' }), { status: 409 })),
    );
    renderizar({ disabled: true });
    await clicar(false);
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');

    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await clicar(false);
    expect(estado(renderizar({ disabled: true }))).toBe('pausada');
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

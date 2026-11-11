import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// A transcrição da ligação (4d) com um DUBLÊ roteirizado: cada leitura ou
// escrita em `cb_ligacoes` devolve a próxima resposta do roteiro, na ordem em
// que o módulo as faz, e a cadeia de filtros fica gravada para conferir o
// cadeado e a cerca. O provedor é o `fetch` falso. Dados fictícios.
// ============================================================

const escolherLeitor = vi.fn();
vi.mock('@/lib/transcricao/escolher-leitor', () => ({
  escolherLeitor: (...a: unknown[]) => escolherLeitor(...a),
}));

const { retomarTranscricoes, transcreverLigacao, TENTATIVAS_DA_TRANSCRICAO } = await import('./transcricao');

const CONTA = '00000000-0000-4000-8000-000000000001';
const LIGACAO = '11111111-2222-4333-8444-555555555555';
const FAIXA = 'faixa-1';

type Resposta = { data: unknown; error: { message: string } | null };
type Chamada = { tabela: string; op: string; patch?: unknown; filtros: [string, unknown[]][] };

function duble(roteiro: {
  ligacoes: Resposta[];
  lista?: Resposta;
  baixar?: (caminho: string) => Resposta;
  removerErro?: { message: string } | null;
}) {
  const chamadas: Chamada[] = [];
  const rpcs: { nome: string; args: unknown }[] = [];
  const removidos: string[][] = [];
  const fila = [...roteiro.ligacoes];

  function consulta(tabela: string) {
    const c: Chamada = { tabela, op: 'select', filtros: [] };
    chamadas.push(c);
    const responder = (): Resposta => {
      if (tabela !== 'cb_ligacoes') return { data: null, error: null };
      const r = fila.shift();
      if (!r) throw new Error(`roteiro acabou numa ${c.op} de cb_ligacoes`);
      return r;
    };
    const q: Record<string, unknown> = {};
    for (const nome of ['select', 'eq', 'is', 'lt', 'gte', 'not', 'or', 'order', 'limit', 'in']) {
      q[nome] = (...args: unknown[]) => {
        if (nome !== 'select') c.filtros.push([nome, args]);
        return q;
      };
    }
    q.update = (patch: unknown) => ((c.op = 'update'), (c.patch = patch), q);
    q.insert = (patch: unknown) => ((c.op = 'insert'), (c.patch = patch), Promise.resolve({ error: null }));
    q.maybeSingle = async () => responder();
    q.then = (ok: (r: Resposta) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(responder()).then(ok, falha);
    return q;
  }

  const db = {
    from: (tabela: string) => consulta(tabela),
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args });
      return { data: true, error: null };
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe('ligacoes');
        return {
          list: async () => roteiro.lista ?? { data: [{ name: 'estereo.ogg' }, { name: 'cliente.ogg' }, { name: 'atendente.ogg' }], error: null },
          download: async (caminho: string) => {
            const r = roteiro.baixar?.(caminho);
            if (r) return r;
            const lado = caminho.endsWith('/cliente.ogg') ? 'CLIENTE' : 'ATENDENTE';
            return { data: new Blob([lado]), error: null };
          },
          remove: async (caminhos: string[]) => {
            removidos.push(caminhos);
            return { data: [], error: roteiro.removerErro ?? null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;

  return { db, chamadas, rpcs, removidos, restante: () => fila.length };
}

const LINHA = {
  id: LIGACAO,
  account_id: CONTA,
  conversation_id: 'conversa-1',
  message_id: FAIXA,
  pelo_crm: true,
  atendida_pelo_crm_em: new Date(Date.now() - 60_000).toISOString(),
  gravacao_expirada_em: null,
  transcricao_status: null,
  transcricao_tentativas: 0,
};
const ok = (data: unknown): Resposta => ({ data, error: null });

/** O corpo do Gemini que entrega `texto` (o JSON dos trechos ou o resumo). */
const gemini = (texto: string, fim = 'STOP') =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: texto }] }, finishReason: fim }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
    }),
    { status: 200 },
  );

const LADO_CLIENTE = JSON.stringify({ trechos: [{ inicio: '00:01', texto: 'Alô?' }, { inicio: '00:09', texto: 'Quero saber do processo.' }] });
const LADO_ATENDENTE = JSON.stringify({ trechos: [{ inicio: '00:02', texto: 'Bom dia, aqui é do escritório.' }] });

let pedidos: { url: string; corpo: unknown }[];
let provedor: (url: string, corpo: unknown) => Response | Promise<Response>;

beforeEach(() => {
  pedidos = [];
  escolherLeitor.mockResolvedValue({ ok: true, provedor: 'gemini', chave: 'chave-ficticia' });
  provedor = (_url, corpo) => {
    const partes = (corpo as { contents: { parts: { text?: string; inlineData?: { data: string } }[] }[] }).contents[0].parts;
    const audio = partes.find((p) => p.inlineData)?.inlineData?.data;
    if (!audio) return gemini('O cliente pediu notícias do processo; o escritório vai conferir.');
    const lado = Buffer.from(audio, 'base64').toString();
    return gemini(lado === 'CLIENTE' ? LADO_CLIENTE : LADO_ATENDENTE);
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const corpo = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
      pedidos.push({ url, corpo });
      return provedor(url, corpo);
    }),
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('transcreverLigacao', () => {
  it('os dois lados viram o diálogo intercalado, com resumo; a faixa e o bucket acompanham', async () => {
    const d = duble({ ligacoes: [ok(LINHA), ok({ id: LIGACAO }), ok({ id: LIGACAO })] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('pronta');

    // O cadeado: teto de tentativas no WHERE, amarrado ao valor lido, e o recolhimento da travada.
    const cadeado = d.chamadas.filter((c) => c.tabela === 'cb_ligacoes' && c.op === 'update')[0];
    expect(cadeado.patch).toMatchObject({ transcricao_status: 'transcrevendo', transcricao_tentativas: 1 });
    expect(cadeado.filtros).toContainEqual(['lt', ['transcricao_tentativas', TENTATIVAS_DA_TRANSCRICAO]]);
    expect(cadeado.filtros).toContainEqual(['eq', ['transcricao_tentativas', 0]]);
    const or = cadeado.filtros.find(([n]) => n === 'or')?.[1][0] as string;
    expect(or).toMatch(/^transcricao_status\.is\.null,transcricao_status\.eq\.falhou,and\(transcricao_status\.eq\.transcrevendo,transcricao_desde\.lt\./);

    // A escrita final, com a cerca do próprio carimbo.
    const final = d.chamadas.filter((c) => c.tabela === 'cb_ligacoes' && c.op === 'update')[1];
    const carimbo = (cadeado.patch as { transcricao_desde: string }).transcricao_desde;
    expect(final.filtros).toContainEqual(['eq', ['transcricao_desde', carimbo]]);
    expect(final.patch).toMatchObject({
      transcricao_status: 'pronta',
      resumo: 'O cliente pediu notícias do processo; o escritório vai conferir.',
      transcricao: [
        { quem: 'cliente', inicio: 1, texto: 'Alô?' },
        { quem: 'atendente', inicio: 2, texto: 'Bom dia, aqui é do escritório.' },
        { quem: 'cliente', inicio: 9, texto: 'Quero saber do processo.' },
      ],
    });

    // A faixa sincroniza depois do cadeado e depois do diálogo gravado.
    expect(d.rpcs).toEqual([
      { nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: LIGACAO } },
      { nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: LIGACAO } },
    ]);
    expect(d.removidos).toEqual([
      [`account-${CONTA}/ligacoes/${LIGACAO}/cliente.ogg`, `account-${CONTA}/ligacoes/${LIGACAO}/atendente.ogg`],
    ]);
    // Dois lados com saída JSON + o resumo; a chave no cabeçalho, nunca na URL.
    expect(pedidos).toHaveLength(3);
    expect(pedidos.every((p) => !p.url.includes('key='))).toBe(true);
    const lado = pedidos[0].corpo as { generationConfig: Record<string, unknown> };
    expect(lado.generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'application/json' });
    expect(d.restante()).toBe(0);
  });

  it('um lado ainda não chegou: cedo, sem cadeado nem provedor', async () => {
    const d = duble({ ligacoes: [ok(LINHA)], lista: ok([{ name: 'estereo.ogg' }, { name: 'cliente.ogg' }]) });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('cedo');
    expect(d.chamadas.some((c) => c.op === 'update')).toBe(false);
    expect(pedidos).toHaveLength(0);
  });

  it('os lados não vieram em 1 h: recusada de vez (a faixa não fica esperando)', async () => {
    const velha = { ...LINHA, atendida_pelo_crm_em: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    const d = duble({ ligacoes: [ok(velha), ok({ id: LIGACAO })], lista: ok([{ name: 'estereo.ogg' }]) });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('recusada');
    const escrita = d.chamadas.find((c) => c.op === 'update');
    expect(escrita?.patch).toMatchObject({ transcricao_status: 'recusada' });
    expect(d.rpcs).toEqual([{ nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: LIGACAO } }]);
  });

  it('a espera dos lados conta do FIM da ligação (a de 30 min não gasta a hora falando)', async () => {
    const longa = {
      ...LINHA,
      atendida_pelo_crm_em: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      desfecho_em: new Date(Date.now() - 10 * 60_000).toISOString(),
    };
    const d = duble({ ligacoes: [ok(longa)], lista: ok([{ name: 'estereo.ogg' }]) });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('cedo');
    expect(d.chamadas.some((c) => c.op === 'update')).toBe(false);
  });

  it('um lado cai no meio (rede): falhou, e o custo do lado que respondeu entra assim mesmo', async () => {
    const original = provedor;
    provedor = (url, corpo) => {
      const audio = (corpo as { contents: { parts: { inlineData?: { data: string } }[] }[] }).contents[0].parts.find((p) => p.inlineData);
      if (audio && Buffer.from(audio.inlineData!.data, 'base64').toString() === 'CLIENTE') throw new TypeError('fetch failed');
      return original(url, corpo);
    };
    const d = duble({ ligacoes: [ok(LINHA), ok({ id: LIGACAO }), ok({ id: LIGACAO })] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('falhou');
    await new Promise((r) => setTimeout(r, 0));
    expect(d.chamadas.filter((c) => c.tabela === 'ai_usage_log' && c.op === 'insert')).toHaveLength(1);
    const falha = d.chamadas.filter((c) => c.op === 'update' && c.tabela === 'cb_ligacoes')[1];
    expect(falha.patch).toMatchObject({ transcricao_status: 'falhou', transcricao_erro: 'fetch failed' });
  });

  it('sem chave do Gemini nem da OpenAI: nada gravado (tenta de novo quando houver)', async () => {
    escolherLeitor.mockResolvedValue({ ok: false, motivo: 'sem_chave' });
    const d = duble({ ligacoes: [ok(LINHA)] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('sem_chave');
    expect(d.chamadas.some((c) => c.op === 'update')).toBe(false);
  });

  it('não atendida, expirada ou já decidida: nada a fazer', async () => {
    for (const linha of [
      { ...LINHA, atendida_pelo_crm_em: null },
      { ...LINHA, gravacao_expirada_em: '2026-01-01T00:00:00Z' },
      { ...LINHA, transcricao_status: 'pronta' },
      { ...LINHA, transcricao_status: 'recusada' },
      { ...LINHA, pelo_crm: false },
    ]) {
      const d = duble({ ligacoes: [ok(linha)] });
      expect(await transcreverLigacao(d.db, LIGACAO)).toBe('nada');
    }
  });

  it('outro processo levou o cadeado: ocupada, sem chamar o provedor', async () => {
    const d = duble({ ligacoes: [ok(LINHA), ok(null)] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('ocupada');
    expect(pedidos).toHaveLength(0);
  });

  it('o provedor falha: falhou (o laço repete) e a faixa sabe; na última tentativa, recusada', async () => {
    provedor = () => new Response('erro', { status: 503 });
    const d = duble({ ligacoes: [ok(LINHA), ok({ id: LIGACAO }), ok({ id: LIGACAO })] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('falhou');
    const falha = d.chamadas.filter((c) => c.op === 'update')[1];
    expect(falha.patch).toMatchObject({ transcricao_status: 'falhou' });

    const ultima = duble({
      ligacoes: [ok({ ...LINHA, transcricao_status: 'falhou', transcricao_tentativas: 2 }), ok({ id: LIGACAO }), ok({ id: LIGACAO })],
    });
    expect(await transcreverLigacao(ultima.db, LIGACAO)).toBe('recusada');
    const terminal = ultima.chamadas.filter((c) => c.op === 'update')[1];
    expect(terminal.patch).toMatchObject({ transcricao_status: 'recusada' });
    expect(String((terminal.patch as { transcricao_erro: string }).transcricao_erro)).toMatch(/^tentativas esgotadas/);
    expect(ultima.rpcs.at(-1)).toEqual({ nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: LIGACAO } });
  });

  it('um lado parou no teto de tokens: recusada (repetir pagaria o mesmo)', async () => {
    provedor = (_url, corpo) => {
      const tem = JSON.stringify(corpo).includes('inlineData');
      return tem ? gemini('{"trechos": [', 'MAX_TOKENS') : gemini('resumo');
    };
    const d = duble({ ligacoes: [ok(LINHA), ok({ id: LIGACAO }), ok({ id: LIGACAO })] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('recusada');
    expect(d.removidos).toEqual([]);
  });

  it('o resumo falha: o diálogo grava assim mesmo, sem resumo', async () => {
    const original = provedor;
    provedor = (url, corpo) => (JSON.stringify(corpo).includes('inlineData') ? original(url, corpo) : new Response('x', { status: 500 }));
    const d = duble({ ligacoes: [ok(LINHA), ok({ id: LIGACAO }), ok({ id: LIGACAO })] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('pronta');
    const final = d.chamadas.filter((c) => c.op === 'update')[1];
    expect(final.patch).toMatchObject({ transcricao_status: 'pronta', resumo: null });
  });

  it('pela OpenAI: whisper-1 com verbose_json e os trechos com horário', async () => {
    escolherLeitor.mockResolvedValue({ ok: true, provedor: 'openai', chave: 'chave-ficticia' });
    provedor = (url, corpo) => {
      if (url.endsWith('/audio/transcriptions')) {
        const form = corpo as FormData;
        expect(form.get('model')).toBe('whisper-1');
        expect(form.get('response_format')).toBe('verbose_json');
        expect(form.get('timestamp_granularities[]')).toBe('segment');
        return new Response(JSON.stringify({ text: 'Oi.', segments: [{ start: 0.5, end: 1, text: ' Oi.' }] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'Saudação rápida.' }] }],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
        { status: 200 },
      );
    };
    const d = duble({ ligacoes: [ok(LINHA), ok({ id: LIGACAO }), ok({ id: LIGACAO })] });
    expect(await transcreverLigacao(d.db, LIGACAO)).toBe('pronta');
    const final = d.chamadas.filter((c) => c.op === 'update')[1];
    expect(final.patch).toMatchObject({
      resumo: 'Saudação rápida.',
      transcricao: [
        { quem: 'cliente', inicio: 0.5, texto: 'Oi.' },
        { quem: 'atendente', inicio: 0.5, texto: 'Oi.' },
      ],
    });
  });
});

describe('retomarTranscricoes', () => {
  it('passada a janela de 7 dias, a que ficou em falhou ou travada vira recusada (a faixa sai de "Transcrevendo…")', async () => {
    const d = duble({ ligacoes: [ok([{ id: LIGACAO }]), ok({ id: LIGACAO }), ok([])] });
    await retomarTranscricoes(d.db, Date.now() + 10 * 60_000);
    const [varredura, encerra, pendentes] = d.chamadas.filter((c) => c.tabela === 'cb_ligacoes');
    expect(varredura.filtros).toContainEqual(['in', ['transcricao_status', ['falhou', 'transcrevendo']]]);
    expect(encerra.op).toBe('update');
    expect(encerra.patch).toMatchObject({ transcricao_status: 'recusada', transcricao_desde: null });
    expect(encerra.filtros).toContainEqual(['in', ['transcricao_status', ['falhou', 'transcrevendo']]]);
    expect(d.rpcs).toEqual([{ nome: 'cb_ligacao_sincronizar_faixa', args: { p_ligacao: LIGACAO } }]);
    // A fila das pendentes: as que já falharam antes das nunca tentadas, as
    // mais novas primeiro, sem o teto de tentativas no filtro.
    expect(pendentes.filtros).toContainEqual(['order', ['transcricao_status', { ascending: true, nullsFirst: false }]]);
    expect(pendentes.filtros).toContainEqual(['order', ['criada_em', { ascending: false }]]);
    expect(pendentes.filtros.some(([n, a]) => n === 'lt' && a[0] === 'transcricao_tentativas')).toBe(false);
    expect(pedidos).toHaveLength(0);
    expect(d.restante()).toBe(0);
  });
});

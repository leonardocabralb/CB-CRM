import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { BATCH_SEND_ATTEMPTS } from '@/lib/broadcast-retry';
import type { createClient } from '@/lib/supabase/client';
import {
  encerrarSemEnviar,
  enviarLoteComPosse,
  fecharCampanhaComAPosse,
  type InterrupcaoDoEnvio,
} from './use-broadcast-sending';

// ============================================================
// NOSSO (posse do envio, 1147): o assistente só manda um lote com a POSSE.
// Antes, a tela da campanha oferecia o Retomar enquanto o assistente ainda
// mandava do navegador, e a retomada mandava os mesmos pendentes pelo
// servidor — o modelo PAGO em dobro.
//
// O que este arquivo segura: sem posse, NENHUM envio a mais, nada a gravar
// (o lote fica `pending` para quem assumiu) e nada é repetido.
// ============================================================

function resposta(status: number, corpo: unknown, retryAfter?: string): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: retryAfter ? { 'Retry-After': retryAfter } : {},
  });
}

const OK = { success: true, results: [{ phone: '5583980000016', status: 'sent', recipient_id: 'r1' }] };

function posseQueResponde(...respostas: (InterrupcaoDoEnvio | null)[]) {
  return vi.fn(async () => (respostas.length ? respostas.shift()! : null));
}

const semEspera = vi.fn(async () => undefined);

describe('enviarLoteComPosse', () => {
  it('com a posse: envia uma vez e devolve o que a rota respondeu', async () => {
    const enviar = vi.fn(async () => resposta(200, OK));
    const manterPosse = posseQueResponde(null);

    const lote = await enviarLoteComPosse(enviar, manterPosse, semEspera);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(manterPosse).toHaveBeenCalledTimes(1);
    expect(lote).toEqual({ desfecho: { resultados: OK.results } });
  });

  it('⚠️⚠️ posse perdida ANTES do lote: nenhum envio, e a parada sobe (nada a gravar)', async () => {
    const enviar = vi.fn(async () => resposta(200, OK));

    const lote = await enviarLoteComPosse(enviar, posseQueResponde('posse_perdida'), semEspera);

    expect(enviar).not.toHaveBeenCalled();
    expect(lote).toEqual({ interrupcao: 'posse_perdida', resultados: [] });
  });

  it('posse incerta (a conexão caiu) também PARA antes de enviar', async () => {
    const enviar = vi.fn(async () => resposta(200, OK));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde('posse_incerta'), semEspera);
    expect(enviar).not.toHaveBeenCalled();
    expect(lote).toEqual({ interrupcao: 'posse_incerta', resultados: [] });
  });

  it('⚠️⚠️ 429 e a posse perdida na espera: o lote (recusado) NÃO é repetido', async () => {
    const enviar = vi.fn(async () => resposta(429, { error: 'Too many requests' }, '30'));
    const esperas: number[] = [];

    const lote = await enviarLoteComPosse(
      enviar,
      posseQueResponde(null, 'posse_perdida'),
      async (ms) => {
        esperas.push(ms);
      },
    );

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(esperas).toEqual([30_000]);
    expect(lote).toEqual({ interrupcao: 'posse_perdida', resultados: [] });
  });

  it('429 com a posse renovada na espera: repete o lote (o 429 garante que nada saiu)', async () => {
    const enviar = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(resposta(429, { error: 'Too many requests' }))
      .mockResolvedValueOnce(resposta(200, OK));
    const manterPosse = posseQueResponde(null, null);

    const lote = await enviarLoteComPosse(enviar, manterPosse, semEspera);

    expect(enviar).toHaveBeenCalledTimes(2);
    expect(manterPosse).toHaveBeenCalledTimes(2);
    expect(lote).toEqual({ desfecho: { resultados: OK.results } });
  });

  it('429 em todas as tentativas: o lote vira erro, sem passar do teto de tentativas', async () => {
    const enviar = vi.fn(async () => resposta(429, { error: 'Too many requests' }));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(), semEspera);
    expect(enviar).toHaveBeenCalledTimes(BATCH_SEND_ATTEMPTS);
    expect(lote).toEqual({ desfecho: { erro: 'Too many requests' } });
  });

  it('500 (pode ter saído): não repete, vira o erro do lote como antes', async () => {
    const enviar = vi.fn(async () => resposta(500, { error: 'boom' }));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(lote).toEqual({ desfecho: { erro: 'boom' } });
  });

  it('a conexão caiu no meio do lote: erro do lote (a gravação decide pelo que a rota anotou)', async () => {
    const enviar = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);
    expect(lote).toEqual({ desfecho: { erro: 'Failed to fetch' } });
  });

  it('⚠️⚠️ a ROTA perdeu a posse no meio do lote (409): para com o que ela processou, sem repetir', async () => {
    const parcial = [{ phone: '5583980000016', status: 'sent', recipient_id: 'r1', anotado: true }];
    const enviar = vi.fn(async () =>
      resposta(409, { success: false, code: 'posse_perdida', results: parcial }),
    );

    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);

    expect(enviar).toHaveBeenCalledTimes(1);
    expect(lote).toEqual({ interrupcao: 'posse_perdida', resultados: parcial });
  });

  it('a rota não conseguiu conferir a posse (409 posse_incerta): também para', async () => {
    const enviar = vi.fn(async () => resposta(409, { success: false, code: 'posse_incerta', results: [] }));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);
    expect(lote).toEqual({ interrupcao: 'posse_incerta', resultados: [] });
  });

  it('409 sem o código da posse continua sendo o erro do lote (como antes)', async () => {
    const enviar = vi.fn(async () => resposta(409, { error: 'outro conflito' }));
    const lote = await enviarLoteComPosse(enviar, posseQueResponde(null), semEspera);
    expect(lote).toEqual({ desfecho: { erro: 'outro conflito' } });
  });
});

// ------------------------------------------------------------
// O fim e os abortos do assistente: só com o TOKEN da posse.
// ------------------------------------------------------------

type Chamada = { tabela: string; op: string; patch?: unknown; filtros: [string, unknown][] };

/** Um supabase de mentira: o UPDATE responde `linhasDoUpdate`; o SELECT, `tokenAtual`. */
function bancoDoFim(opcoes: {
  linhasDoUpdate?: unknown[] | null;
  erroDoUpdate?: { message: string } | null;
  tokenAtual?: string | null;
  erroDaLeitura?: { message: string } | null;
}) {
  const chamadas: Chamada[] = [];
  const db = {
    from: (tabela: string) => {
      const chamada: Chamada = { tabela, op: '', filtros: [] };
      chamadas.push(chamada);
      const q: Record<string, unknown> = {
        update: (patch: unknown) => {
          chamada.op = 'update';
          chamada.patch = patch;
          return q;
        },
        select: () => {
          if (!chamada.op) chamada.op = 'select';
          return q;
        },
        eq: (coluna: string, valor: unknown) => {
          chamada.filtros.push([coluna, valor]);
          return q;
        },
        maybeSingle: async () => ({
          data: opcoes.erroDaLeitura ? null : { delivery_lease_token: opcoes.tokenAtual ?? null },
          error: opcoes.erroDaLeitura ?? null,
        }),
        then: (resolver: (r: unknown) => unknown) =>
          Promise.resolve(
            resolver({
              data: opcoes.erroDoUpdate ? null : (opcoes.linhasDoUpdate ?? []),
              error: opcoes.erroDoUpdate ?? null,
            }),
          ),
      };
      return q;
    },
  } as unknown as ReturnType<typeof createClient>;
  return { db, chamadas };
}

describe('fecharCampanhaComAPosse', () => {
  it('grava o status e SOLTA a posse, só com o token', async () => {
    const { db, chamadas } = bancoDoFim({ linhasDoUpdate: [{ id: 'bc-1' }] });
    expect(await fecharCampanhaComAPosse(db, 'bc-1', 'tok', 'sent')).toEqual({
      statusPerdido: false,
      posseMudou: false,
    });
    expect(chamadas[0].patch).toEqual({
      status: 'sent',
      delivery_lease_until: null,
      delivery_lease_token: null,
    });
    expect(chamadas[0].filtros).toEqual([
      ['id', 'bc-1'],
      ['delivery_lease_token', 'tok'],
    ]);
  });

  it('⚠️ 0 linhas e o token mudou: a posse é de outro (não é escrita perdida)', async () => {
    const { db } = bancoDoFim({ linhasDoUpdate: [], tokenAtual: null });
    expect(await fecharCampanhaComAPosse(db, 'bc-1', 'tok', 'sent')).toEqual({
      statusPerdido: false,
      posseMudou: true,
    });
  });

  it('0 linhas com o token ainda nosso: escrita perdida (RLS), o aviso de sempre', async () => {
    const { db } = bancoDoFim({ linhasDoUpdate: [], tokenAtual: 'tok' });
    expect(await fecharCampanhaComAPosse(db, 'bc-1', 'tok', 'failed')).toEqual({
      statusPerdido: true,
      posseMudou: false,
    });
  });

  it('erro na escrita, ou na leitura que mede: escrita perdida, nunca "outro assumiu"', async () => {
    expect(
      await fecharCampanhaComAPosse(bancoDoFim({ erroDoUpdate: { message: 'x' } }).db, 'bc-1', 'tok', 'sent'),
    ).toEqual({ statusPerdido: true, posseMudou: false });
    expect(
      await fecharCampanhaComAPosse(
        bancoDoFim({ linhasDoUpdate: [], erroDaLeitura: { message: 'y' } }).db,
        'bc-1',
        'tok',
        'sent',
      ),
    ).toEqual({ statusPerdido: true, posseMudou: false });
  });
});

describe('encerrarSemEnviar', () => {
  it('o aborto solta a posse junto, e só com o token', async () => {
    const { db, chamadas } = bancoDoFim({});
    await encerrarSemEnviar(db, 'bc-1', 'tok', { status: 'failed' });
    expect(chamadas[0].patch).toEqual({
      status: 'failed',
      delivery_lease_until: null,
      delivery_lease_token: null,
    });
    expect(chamadas[0].filtros).toEqual([
      ['id', 'bc-1'],
      ['delivery_lease_token', 'tok'],
    ]);
  });
});

// ------------------------------------------------------------
// A ORDEM dentro de `createAndSendBroadcast` (um hook React: o pino lê o
// código). Cada uma destas, invertida, reabre o envio em dobro ou a campanha
// presa — e passaria verde nos testes das funções.
// ------------------------------------------------------------

describe('createAndSendBroadcast — a ordem da posse', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'use-broadcast-sending.ts'), 'utf8');
  const corpo = fonte.slice(fonte.indexOf('async function createAndSendBroadcast('));
  const pos = (trecho: string) => {
    const i = corpo.indexOf(trecho);
    expect(i, `não achei: ${trecho}`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it('o token nasce ANTES da linha da campanha, e a posse é tomada ANTES dos destinatários', () => {
    expect(pos('crypto.randomUUID()')).toBeLessThan(pos(".from('broadcasts')\n        .insert("));
    expect(pos('tomarPosseDoDisparo(supabase, broadcast.id, tokenDaPosse)')).toBeLessThan(
      pos(".from('broadcast_recipients')\n          .insert(batch)"),
    );
  });

  it('o lote leva a campanha e o token à rota (que renova a posse no meio do lote)', () => {
    expect(corpo).toContain('broadcast_id: broadcast.id,');
    expect(corpo).toContain('posse: tokenDaPosse,');
  });

  it('⚠️⚠️ sem posse: grava só o que a rota processou e PARA antes da gravação normal do lote', () => {
    const parada = pos("if ('interrupcao' in lote) {");
    const quebra = corpo.indexOf('break;', parada);
    const gravacaoNormal = corpo.indexOf(
      'gravarDesfechoDoLote(supabase, batch, lote.desfecho)',
      parada,
    );
    expect(quebra).toBeGreaterThan(parada);
    expect(quebra).toBeLessThan(gravacaoNormal);
    expect(corpo.slice(parada, quebra)).toContain('processados.has(linha.id)');
  });

  it('o fim e os abortos passam pelas funções cercadas pelo token', () => {
    expect(corpo).toContain('fecharCampanhaComAPosse(');
    expect(corpo.match(/encerrarSemEnviar\(supabase, broadcast\.id, tokenDaPosse,/g)).toHaveLength(2);
    // Nenhum UPDATE de `status` cru em `broadcasts` depois de tomar a posse.
    const depoisDaPosse = corpo.slice(pos('tomarPosseDoDisparo(supabase, broadcast.id, tokenDaPosse)'));
    const semAntesDoThrow = depoisDaPosse.slice(depoisDaPosse.indexOf("throw new Error(tNew('sendNotStarted'))"));
    expect(semAntesDoThrow).not.toMatch(/\.from\('broadcasts'\)\s*\.update\(/);
  });
});

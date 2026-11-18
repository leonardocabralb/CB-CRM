import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  lerDestinatariosDaCampanha,
  linhaDoCsv,
  mostrarFaixaDasIncertas,
  ordenarComoATela,
  painelDaRetomada,
} from './broadcast-painel';
import { MAX_PAGINAS, PAGINA } from './supabase/paginar';

// ------------------------------------------------------------
// NOSSO (1151): a ENTREGA INCERTA na tela — a faixa só com o envio parado, e
// no CSV a situação traduzida com a frase "pode ter chegado".
// ------------------------------------------------------------

describe('mostrarFaixaDasIncertas', () => {
  it('só com incerta e com o envio PARADO', () => {
    expect(mostrarFaixaDasIncertas(2, false)).toBe(true);
    expect(mostrarFaixaDasIncertas(0, false)).toBe(false);
  });

  it('⚠️ com envio rodando, a linha que está saindo fica incerta por um instante: a faixa não afirma', () => {
    expect(mostrarFaixaDasIncertas(1, true)).toBe(false);
    // Sem saber, também não.
    expect(mostrarFaixaDasIncertas(1, null)).toBe(false);
  });
});

describe('linhaDoCsv', () => {
  const textos = { situacao: (s: string) => `[${s}]`, incerta: 'Pode ter chegado — confira antes de reenviar' };
  const base = {
    contact: { name: 'Ana', phone: '5583988745316' },
    sent_at: undefined,
    delivered_at: undefined,
    read_at: undefined,
  };

  it('a situação sai TRADUZIDA (não o código), e as colunas na ordem do cabeçalho', () => {
    expect(linhaDoCsv({ ...base, status: 'failed', error_message: 'recusado' }, textos)).toEqual([
      'Ana',
      '5583988745316',
      '[failed]',
      '',
      '',
      '',
      'recusado',
    ]);
  });

  it('⚠️⚠️ na entrega incerta, a frase vem antes do motivo técnico — no CSV ela não parece falha', () => {
    expect(
      linhaDoCsv({ ...base, status: 'uncertain', error_message: 'Meta API error: 503' }, textos)[6],
    ).toBe('Pode ter chegado — confira antes de reenviar — Meta API error: 503');
    // Sem motivo (o processo morreu no meio): só a frase.
    expect(linhaDoCsv({ ...base, status: 'uncertain' }, textos)[6]).toBe(
      'Pode ter chegado — confira antes de reenviar',
    );
  });

  it('contato apagado (nulo) não quebra a linha', () => {
    expect(linhaDoCsv({ ...base, contact: null, status: 'sent' }, textos).slice(0, 3)).toEqual(['', '', '[sent]']);
  });
});

// ============================================================
// A tela da campanha (#683 e #679 do original, NOSSO na forma):
//  - a faixa de cima nunca diz "parou no meio" nem oferece o Retomar com um
//    envio rodando (o Retomar mandava o modelo pago em dobro);
//  - os destinatários vêm TODOS, por chave — o corte de 1.000 do PostgREST
//    deixava tabela, filtro, contagens do Retomar e CSV pela metade.
// ============================================================

describe('painelDaRetomada — "concluir" (1151)', () => {
  const vazia = { pendentes: 0, falhos: 0 };

  it('⚠️ `sending` sem ninguém pendente nem falho, e ninguém enviando: "concluir" (senão fica "Enviando" para sempre)', () => {
    expect(painelDaRetomada({ ...vazia, status: 'sending', emAndamento: false })).toBe('concluir');
  });

  it('com envio rodando ou sem saber, não oferece concluir', () => {
    expect(painelDaRetomada({ ...vazia, status: 'sending', emAndamento: true })).toBeNull();
    expect(painelDaRetomada({ ...vazia, status: 'sending', emAndamento: null })).toBeNull();
  });

  it('campanha já fechada sem nada pendente: nada a mostrar', () => {
    expect(painelDaRetomada({ ...vazia, status: 'sent', emAndamento: false })).toBeNull();
    expect(painelDaRetomada({ ...vazia, status: 'failed', emAndamento: false })).toBeNull();
  });
});

describe('painelDaRetomada', () => {
  const base = { status: 'sending' as const, pendentes: 5, falhos: 0 };

  it('⚠️⚠️ envio em andamento: nem "parado" nem Retomar', () => {
    expect(painelDaRetomada({ ...base, emAndamento: true })).toBe('em_andamento');
    expect(painelDaRetomada({ ...base, falhos: 3, emAndamento: true })).toBe('em_andamento');
  });

  it('⚠️ não deu para conferir: "desconhecido", nunca "parado"', () => {
    expect(painelDaRetomada({ ...base, emAndamento: null })).toBe('desconhecido');
  });

  it('ninguém enviando, `sending` com pendentes: parou no meio', () => {
    expect(painelDaRetomada({ ...base, emAndamento: false })).toBe('parado');
  });

  it('campanha fechada com falhas (ou pendentes): tentar de novo', () => {
    expect(
      painelDaRetomada({ status: 'sent', pendentes: 0, falhos: 2, emAndamento: false }),
    ).toBe('retentar');
    expect(
      painelDaRetomada({ status: 'sent', pendentes: 1, falhos: 0, emAndamento: false }),
    ).toBe('retentar');
    expect(
      painelDaRetomada({ status: 'sending', pendentes: 0, falhos: 2, emAndamento: false }),
    ).toBe('retentar');
  });

  it('nada pendente nem falho: sem faixa (a campanha `sending` parada é o "concluir" da 1151, acima)', () => {
    for (const emAndamento of [true, false, null]) {
      expect(painelDaRetomada({ status: 'sent', pendentes: 0, falhos: 0, emAndamento })).toBeNull();
    }
    for (const emAndamento of [true, null]) {
      expect(
        painelDaRetomada({ status: 'sending', pendentes: 0, falhos: 0, emAndamento }),
      ).toBeNull();
    }
  });
});

describe('ordenarComoATela', () => {
  it('mais novos primeiro, desempate pelo id (a ordem que o `select` cru dava)', () => {
    const linhas = [
      { id: 'a', created_at: '2026-11-17T10:00:00+00:00' },
      { id: 'c', created_at: '2026-11-17T11:00:00+00:00' },
      { id: 'b', created_at: '2026-11-17T11:00:00+00:00' },
    ];
    expect(ordenarComoATela(linhas).map((l) => l.id)).toEqual(['c', 'b', 'a']);
    // Não mexe na lista recebida.
    expect(linhas.map((l) => l.id)).toEqual(['a', 'c', 'b']);
  });
});

/** Um PostgREST de mentira com `n` destinatários, que responde por chave. */
function bancoComDestinatarios(
  n: number,
  opcoes: { falharNaPagina?: number } = {},
): { db: SupabaseClient; paginas: { depoisDe: string | null; broadcastId: unknown }[] } {
  const todas = Array.from({ length: n }, (_, i) => ({
    id: `r-${String(i).padStart(6, '0')}`,
    broadcast_id: 'bc-1',
    status: 'pending',
    // Ordem de criação diferente da do id, para a tela reordenar.
    created_at: new Date(Date.UTC(2026, 10, 17, 0, 0, i % 60)).toISOString(),
  }));
  const paginas: { depoisDe: string | null; broadcastId: unknown }[] = [];
  const db = {
    from: (tabela: string) => {
      expect(tabela).toBe('broadcast_recipients');
      const estado: { depoisDe: string | null; broadcastId: unknown; limite: number } = {
        depoisDe: null,
        broadcastId: null,
        limite: Infinity,
      };
      const consulta = {
        select: (colunas: string) => {
          expect(colunas).toContain('contact:contacts(');
          return consulta;
        },
        eq: (coluna: string, valor: unknown) => {
          expect(coluna).toBe('broadcast_id');
          estado.broadcastId = valor;
          return consulta;
        },
        order: (coluna: string, o: { ascending: boolean }) => {
          expect([coluna, o.ascending]).toEqual(['id', true]);
          return consulta;
        },
        limit: (l: number) => {
          estado.limite = l;
          return consulta;
        },
        gt: (coluna: string, valor: string) => {
          expect(coluna).toBe('id');
          estado.depoisDe = valor;
          return consulta;
        },
        then: (resolver: (r: unknown) => unknown) => {
          paginas.push({ depoisDe: estado.depoisDe, broadcastId: estado.broadcastId });
          if (opcoes.falharNaPagina === paginas.length) {
            return Promise.resolve(resolver({ data: null, error: { message: 'timeout' } }));
          }
          const data = todas
            .filter((l) => estado.depoisDe === null || l.id > estado.depoisDe)
            .slice(0, estado.limite);
          return Promise.resolve(resolver({ data, error: null }));
        },
      };
      return consulta;
    },
  } as unknown as SupabaseClient;
  return { db, paginas };
}

describe('lerDestinatariosDaCampanha', () => {
  it('⚠️⚠️ passa de 1.000: traz TODOS, por chave, em fila', async () => {
    const { db, paginas } = bancoComDestinatarios(2_345);
    const { linhas, motivo } = await lerDestinatariosDaCampanha(db, 'bc-1');

    expect(motivo).toBeNull();
    expect(linhas).toHaveLength(2_345);
    expect(new Set(linhas!.map((l) => l.id)).size).toBe(2_345);
    expect(paginas.map((p) => p.depoisDe)).toEqual([null, 'r-000999', 'r-001999']);
    expect(paginas.every((p) => p.broadcastId === 'bc-1')).toBe(true);
  });

  it('sai na ordem da tela (mais novos primeiro)', async () => {
    const { db } = bancoComDestinatarios(3);
    const { linhas } = await lerDestinatariosDaCampanha(db, 'bc-1');
    expect(linhas!.map((l) => l.id)).toEqual(['r-000002', 'r-000001', 'r-000000']);
  });

  it('⚠️ falha no meio: null ("não confie"), nunca as 1.000 da primeira página', async () => {
    const { db } = bancoComDestinatarios(1_500, { falharNaPagina: 2 });
    const { linhas, motivo } = await lerDestinatariosDaCampanha(db, 'bc-1');
    expect(linhas).toBeNull();
    expect(motivo).toBe('erro');
  });

  it('⚠️ acima do teto: null com o motivo "teto", nunca a lista cortada', async () => {
    const { db } = bancoComDestinatarios(MAX_PAGINAS * PAGINA + 1);
    const { linhas, motivo } = await lerDestinatariosDaCampanha(db, 'bc-1');
    expect(linhas).toBeNull();
    expect(motivo).toBe('teto');
  });

  it('exatamente no teto ainda é a lista inteira (a sondagem vazia fecha)', async () => {
    const { db } = bancoComDestinatarios(MAX_PAGINAS * PAGINA);
    const { linhas, motivo } = await lerDestinatariosDaCampanha(db, 'bc-1');
    expect(motivo).toBeNull();
    expect(linhas).toHaveLength(MAX_PAGINAS * PAGINA);
  });
});

// ============================================================
// A PÁGINA da campanha (`broadcasts/[id]/page.tsx`) — o que só se vê lendo o
// fonte: a ordem das leituras, a regra da faixa e o CSV.
// ============================================================
describe('a página da campanha usa as regras daqui', () => {
  const pagina = readFileSync(
    join(process.cwd(), 'src/app/(dashboard)/broadcasts/[id]/page.tsx'),
    'utf8',
  );

  it('⚠️ lê o ANDAMENTO antes dos destinatários', () => {
    // Na ordem inversa, um envio que terminasse entre as duas leituras deixava
    // pendentes velhos com "ninguém enviando": o "parou no meio" falso.
    const andamento = pagina.indexOf('await disparoEmAndamento(supabase, broadcastId)');
    const destinatarios = pagina.indexOf('await lerDestinatariosDaCampanha(supabase, broadcastId)');
    expect(andamento).toBeGreaterThan(0);
    expect(destinatarios).toBeGreaterThan(andamento);
  });

  it('a faixa sai de `painelDaRetomada`, e o Retomar só com "parado" ou "retentar"', () => {
    expect(pagina).toContain('const painel = painelDaRetomada({');
    expect(pagina).toContain("{(painel === 'parado' || painel === 'retentar') && (");
  });

  it('a faixa "em andamento" promete os dois prazos de verdade (aba e servidor)', () => {
    expect(pagina).toContain('minutosAba: Math.round(PRAZO_DA_POSSE_MS / 60_000)');
    expect(pagina).toContain('minutosServidor: MINUTOS_DA_TRAVA_DA_RETOMADA');
  });

  it('o CSV passa todo campo por `neutralizarFormula`', () => {
    expect(pagina).toContain('`"${neutralizarFormula(v).replace(/"/g, \'""\')}"`');
  });
});

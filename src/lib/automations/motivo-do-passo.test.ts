import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { gravarMotivoDoPasso, motivoDoPasso, notaDoMotivo } from './motivo-do-passo';

// ============================================================
// O motivo que o "Mover card de etapa" grava (1112, Fase 3 dos motivos).
// ============================================================

/** Dublê do banco: a leitura da etapa devolve `etapa`, o upsert devolve `erroDoUpsert`. */
function banco(opcoes: {
  etapa?: { campo_do_motivo_id: string | null } | null;
  erroDaEtapa?: { message: string } | null;
  erroDoUpsert?: { message: string } | null;
}) {
  const pedidos: Array<{ tabela: string; filtros: Array<[string, unknown]>; upsert?: unknown; conflito?: unknown }> =
    [];
  const db = {
    from(tabela: string) {
      const pedido: (typeof pedidos)[number] = { tabela, filtros: [] };
      pedidos.push(pedido);
      const cadeia = {
        select: () => cadeia,
        eq: (coluna: string, valor: unknown) => {
          pedido.filtros.push([coluna, valor]);
          return cadeia;
        },
        maybeSingle: async () => ({ data: opcoes.etapa ?? null, error: opcoes.erroDaEtapa ?? null }),
        upsert: async (linha: unknown, conflito: unknown) => {
          pedido.upsert = linha;
          pedido.conflito = conflito;
          return { error: opcoes.erroDoUpsert ?? null };
        },
      };
      return cadeia;
    },
  } as unknown as SupabaseClient;
  return { db, pedidos };
}

const ENTRADA = { accountId: 'conta', contactId: 'contato', stageId: 'etapa', motivo: 'Desistiu' };

describe('motivoDoPasso', () => {
  it('só texto não vazio, aparado', () => {
    expect(motivoDoPasso({})).toBeNull();
    expect(motivoDoPasso({ motivo: '   ' })).toBeNull();
    expect(motivoDoPasso({ motivo: 42 })).toBeNull();
    expect(motivoDoPasso({ motivo: ' Desistiu ' })).toBe('Desistiu');
  });
});

describe('notaDoMotivo (o texto que o "Já rodou" traduz)', () => {
  it('casa com os padrões de texto-do-motor.ts', () => {
    expect(notaDoMotivo({ tipo: 'sem_motivo' })).toBe('');
    expect(notaDoMotivo({ tipo: 'gravado', motivo: 'Desistiu' })).toBe(' — motivo: Desistiu');
    expect(notaDoMotivo({ tipo: 'nao_gravado', causa: 'sem contato' })).toBe(' — motivo não gravado (sem contato)');
  });
});

describe('gravarMotivoDoPasso', () => {
  it('sem motivo no passo não lê nem grava nada', async () => {
    const { db, pedidos } = banco({ etapa: { campo_do_motivo_id: 'campo' } });
    expect(await gravarMotivoDoPasso(db, { ...ENTRADA, motivo: null })).toBe('');
    expect(pedidos).toEqual([]);
  });

  it('grava no campo da etapa, lendo a etapa PELA CONTA', async () => {
    const { db, pedidos } = banco({ etapa: { campo_do_motivo_id: 'campo' } });
    expect(await gravarMotivoDoPasso(db, ENTRADA)).toBe(' — motivo: Desistiu');
    expect(pedidos[0]).toMatchObject({
      tabela: 'pipeline_stages',
      filtros: [
        ['id', 'etapa'],
        ['pipelines.account_id', 'conta'],
      ],
    });
    expect(pedidos[1]).toMatchObject({
      tabela: 'contact_custom_values',
      upsert: { contact_id: 'contato', custom_field_id: 'campo', value: 'Desistiu' },
      conflito: { onConflict: 'contact_id,custom_field_id' },
    });
  });

  it('nunca lança: cada falha vira nota, e nada é gravado fora do lugar', async () => {
    const semContato = banco({ etapa: { campo_do_motivo_id: 'campo' } });
    expect(await gravarMotivoDoPasso(semContato.db, { ...ENTRADA, contactId: null })).toBe(
      ' — motivo não gravado (sem contato)',
    );
    expect(semContato.pedidos).toEqual([]);

    const etapaFalhou = banco({ erroDaEtapa: { message: 'x' } });
    expect(await gravarMotivoDoPasso(etapaFalhou.db, ENTRADA)).toBe(' — motivo não gravado (etapa não conferida)');
    expect(etapaFalhou.pedidos.some((p) => p.upsert)).toBe(false);

    const naoPede = banco({ etapa: { campo_do_motivo_id: null } });
    expect(await gravarMotivoDoPasso(naoPede.db, ENTRADA)).toBe(' — motivo não gravado (a etapa não pede motivo)');
    expect(naoPede.pedidos.some((p) => p.upsert)).toBe(false);

    // Etapa de outra conta: a leitura pela conta não a acha.
    const deOutraConta = banco({ etapa: null });
    expect(await gravarMotivoDoPasso(deOutraConta.db, ENTRADA)).toBe(
      ' — motivo não gravado (a etapa não pede motivo)',
    );

    const upsertFalhou = banco({ etapa: { campo_do_motivo_id: 'campo' }, erroDoUpsert: { message: 'boom' } });
    expect(await gravarMotivoDoPasso(upsertFalhou.db, ENTRADA)).toBe(' — motivo não gravado (falha ao gravar: boom)');
  });
});

describe('o motor grava o motivo DEPOIS do movimento', () => {
  it('a chamada vem depois da RPC aceita e do card fixado, e entra no registro do passo', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'engine.ts'), 'utf8');
    const inicio = fonte.indexOf("case 'move_deal_stage':");
    const trecho = fonte.slice(inicio, fonte.indexOf("case 'run_automation'", inicio));
    const recusa = trecho.indexOf('recusado:');
    const fixado = trecho.indexOf('args.context.deal_status_fixado =');
    const grava = trecho.indexOf('gravarMotivoDoPasso(');
    expect(recusa).toBeGreaterThan(-1);
    expect(grava).toBeGreaterThan(fixado);
    expect(fixado).toBeGreaterThan(recusa);
    expect(trecho).toMatch(/`negócio movido para \$\{cfg\.stage_id\}\$\{nota\}`/);
  });
});

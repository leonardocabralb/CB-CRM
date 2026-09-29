import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SITUACOES_DO_CLIENTE,
  lerSituacaoDoCliente,
  situacoesDoCliente,
  type NegocioComEtapa,
} from './situacao-do-cliente';

// ============================================================
// A faixa "Cliente rescindido / finalizado" (1070): por funil, o card MAIS
// RECENTE do contato decide, pela MARCA da etapa — nunca pelo nome.
// ============================================================

const JURIDICO = 'funil-juridico';
const COMERCIAL = 'funil-comercial';
const TRABALHISTA = 'funil-trabalhista';

function card(
  pipeline_id: string | null,
  created_at: string,
  etapa: string,
  situacao: string | null,
  funil = 'Funil Exemplo',
): NegocioComEtapa {
  return {
    pipeline_id,
    created_at,
    stage: { name: etapa, situacao_do_cliente: situacao, pipeline: { name: funil } },
  };
}

describe('situacoesDoCliente', () => {
  it('card numa etapa marcada acende, dizendo o funil e a etapa', () => {
    expect(
      situacoesDoCliente([card(JURIDICO, '2026-01-10T12:00:00+00:00', 'Cliente Rescindido', 'rescindido', 'Bancário - Jurídico')]),
    ).toEqual([{ situacao: 'rescindido', funil: 'Bancário - Jurídico', etapa: 'Cliente Rescindido' }]);
  });

  it('etapa sem marca não diz nada — nem pelo NOME', () => {
    expect(situacoesDoCliente([card(JURIDICO, '2026-01-10T12:00:00+00:00', 'Cliente Rescindido', null)])).toEqual([]);
    expect(situacoesDoCliente([card(JURIDICO, '2026-01-10T12:00:00+00:00', 'Cliente Ativo', null)])).toEqual([]);
  });

  it('ex-cliente que voltou por um card NOVO do Comercial: a faixa acende pelo card antigo do Jurídico', () => {
    const negocios = [
      card(JURIDICO, '2025-03-01T12:00:00+00:00', 'Cliente Rescindido', 'rescindido', 'Bancário - Jurídico'),
      card(COMERCIAL, '2026-09-20T12:00:00+00:00', 'MQL 1', null, 'Bancário - Comercial'),
    ];
    expect(situacoesDoCliente(negocios).map((s) => s.funil)).toEqual(['Bancário - Jurídico']);
  });

  it('depois do contrato novo, o card mais recente do Jurídico é o ativo: a faixa apaga', () => {
    const negocios = [
      card(JURIDICO, '2025-03-01T12:00:00+00:00', 'Cliente Rescindido', 'rescindido'),
      // O card do Comercial transferido para o Jurídico: nasceu depois.
      card(JURIDICO, '2026-09-20T12:00:00+00:00', 'Cliente Ativo', null),
    ];
    expect(situacoesDoCliente(negocios)).toEqual([]);
  });

  it('o mais recente vale mesmo quando ele é o marcado e o antigo não', () => {
    const negocios = [
      card(JURIDICO, '2025-03-01T12:00:00+00:00', 'Cliente Ativo', null),
      card(JURIDICO, '2026-09-20T12:00:00+00:00', 'Cliente Finalizado', 'finalizado'),
    ];
    expect(situacoesDoCliente(negocios)).toEqual([
      { situacao: 'finalizado', funil: 'Funil Exemplo', etapa: 'Cliente Finalizado' },
    ]);
  });

  it('a ordem de chegada não importa (compara o instante, não o texto)', () => {
    const negocios = [
      card(JURIDICO, '2026-09-20T09:00:00-03:00', 'Cliente Ativo', null),
      card(JURIDICO, '2026-09-20T11:00:00+00:00', 'Cliente Rescindido', 'rescindido'),
    ];
    // 09:00 em Brasília é 12:00 UTC: o card "Cliente Ativo" é o mais recente.
    expect(situacoesDoCliente(negocios)).toEqual([]);
    expect(situacoesDoCliente([...negocios].reverse())).toEqual([]);
  });

  it('dois funis marcados: rescindido antes de finalizado', () => {
    const negocios = [
      card(TRABALHISTA, '2026-01-01T12:00:00+00:00', 'Encerrado', 'finalizado', 'Trabalhista - Jurídico'),
      card(JURIDICO, '2026-02-01T12:00:00+00:00', 'Cliente Rescindido', 'rescindido', 'Bancário - Jurídico'),
    ];
    expect(situacoesDoCliente(negocios).map((s) => s.situacao)).toEqual(['rescindido', 'finalizado']);
  });

  it('card sem funil ou sem etapa embutida não acende nada', () => {
    expect(situacoesDoCliente([card(null, '2026-01-10T12:00:00+00:00', 'X', 'rescindido')])).toEqual([]);
    expect(
      situacoesDoCliente([{ pipeline_id: JURIDICO, created_at: '2026-01-10T12:00:00+00:00', stage: null }]),
    ).toEqual([]);
  });

  it('valor fora da lista é "não diz nada"', () => {
    expect(lerSituacaoDoCliente('inativo')).toBeNull();
    expect(lerSituacaoDoCliente('')).toBeNull();
    expect(lerSituacaoDoCliente(undefined)).toBeNull();
    expect(lerSituacaoDoCliente('finalizado')).toBe('finalizado');
  });
});

describe('1070 — o CHECK da migration e a lista do código são a mesma', () => {
  const sql = readFileSync(
    join(__dirname, '../../../supabase/migrations/1070_cb_situacao_do_cliente_na_etapa.sql'),
    'utf8',
  ).replace(/--.*$/gm, '');

  it('o CHECK aceita exatamente os valores de SITUACOES_DO_CLIENTE', () => {
    const lista = SITUACOES_DO_CLIENTE.map((s) => `'${s}'`).join(', ');
    expect(sql).toContain(
      `CHECK (situacao_do_cliente IS NULL OR situacao_do_cliente IN (${lista}))`,
    );
  });

  it('a coluna é aditiva e anulável (o app antigo não a manda)', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS situacao_do_cliente text;/);
    expect(sql).not.toMatch(/situacao_do_cliente text NOT NULL/);
    expect(sql).not.toMatch(/situacao_do_cliente text DEFAULT/);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SITUACOES_DO_CLIENTE,
  lerSituacaoDoCliente,
  situacoesDoCliente,
  type EtapaMarcada,
  type EventoDeSaida,
  type NegocioDoContato,
} from './situacao-do-cliente';

// ============================================================
// A faixa "Cliente rescindido / finalizado" (1070). Um card por contato, e
// ele VIAJA entre funis: por funil, vale a etapa ATUAL do card que está lá
// ou, se o card saiu, a etapa de onde ele saiu. Marca, nunca nome.
// ============================================================

const JURIDICO = 'funil-juridico';
const COMERCIAL = 'funil-comercial';
const TRABALHISTA = 'funil-trabalhista';

const RESCINDIDO = 'etapa-rescindido';
const FINALIZADO = 'etapa-finalizado';
const ATIVO = 'etapa-ativo';
const MQL = 'etapa-mql';
const ENCERRADO_TRAB = 'etapa-encerrado-trab';

const ETAPAS: EtapaMarcada[] = [
  { id: RESCINDIDO, name: 'Cliente Rescindido', situacao_do_cliente: 'rescindido', pipeline: { name: 'Bancário - Jurídico' } },
  { id: FINALIZADO, name: 'Cliente Finalizado', situacao_do_cliente: 'finalizado', pipeline: { name: 'Bancário - Jurídico' } },
  { id: ENCERRADO_TRAB, name: 'Encerrado', situacao_do_cliente: 'finalizado', pipeline: { name: 'Trabalhista - Jurídico' } },
];

function card(id: string, pipeline_id: string | null, stage_id: string | null, created_at = '2026-01-10T12:00:00+00:00'): NegocioDoContato {
  return { id, pipeline_id, stage_id, created_at };
}

function transferencia(id: string, de: string, etapaDe: string, para: string, occurred_at: string): EventoDeSaida {
  return { id, event_type: 'pipeline_changed', from_pipeline_id: de, from_stage_id: etapaDe, to_pipeline_id: para, occurred_at };
}

describe('situacoesDoCliente — o card que está no funil', () => {
  it('card numa etapa marcada acende, dizendo o funil e a etapa', () => {
    expect(situacoesDoCliente([card('c1', JURIDICO, RESCINDIDO)], [], ETAPAS)).toEqual([
      { situacao: 'rescindido', funil: 'Bancário - Jurídico', etapa: 'Cliente Rescindido' },
    ]);
  });

  it('etapa sem marca não diz nada — nem pelo NOME', () => {
    const semMarca = ETAPAS.map((e) => ({ ...e, situacao_do_cliente: null }));
    expect(situacoesDoCliente([card('c1', JURIDICO, RESCINDIDO)], [], semMarca)).toEqual([]);
    expect(situacoesDoCliente([card('c1', JURIDICO, ATIVO)], [], ETAPAS)).toEqual([]);
  });

  it('dois cards no mesmo funil: vale o mais recente; no empate de instante, o id desempata sempre igual', () => {
    const antigo = card('a', JURIDICO, ATIVO, '2025-01-01T00:00:00+00:00');
    const novo = card('b', JURIDICO, FINALIZADO, '2026-01-01T00:00:00+00:00');
    expect(situacoesDoCliente([antigo, novo], [], ETAPAS).map((s) => s.situacao)).toEqual(['finalizado']);
    expect(situacoesDoCliente([novo, antigo], [], ETAPAS).map((s) => s.situacao)).toEqual(['finalizado']);

    const x = card('x', JURIDICO, RESCINDIDO, '2026-01-01T00:00:00+00:00');
    const y = card('y', JURIDICO, ATIVO, '2026-01-01T00:00:00+00:00');
    expect(situacoesDoCliente([x, y], [], ETAPAS)).toEqual(situacoesDoCliente([y, x], [], ETAPAS));
  });
});

describe('situacoesDoCliente — o card que SAIU do funil (um card por contato)', () => {
  it('ex-cliente que volta: o ÚNICO card vai do Rescindido para o Comercial e a faixa continua acesa', () => {
    const negocios = [card('c1', COMERCIAL, MQL)];
    const eventos = [transferencia('e1', JURIDICO, RESCINDIDO, COMERCIAL, '2026-09-29T20:00:00+00:00')];
    expect(situacoesDoCliente(negocios, eventos, ETAPAS)).toEqual([
      { situacao: 'rescindido', funil: 'Bancário - Jurídico', etapa: 'Cliente Rescindido' },
    ]);
  });

  it('o contrato novo leva o card de volta ao Jurídico em "Cliente Ativo": a faixa apaga', () => {
    const negocios = [card('c1', JURIDICO, ATIVO)];
    const eventos = [
      transferencia('e1', JURIDICO, RESCINDIDO, COMERCIAL, '2026-09-20T20:00:00+00:00'),
      transferencia('e2', COMERCIAL, MQL, JURIDICO, '2026-09-29T20:00:00+00:00'),
    ];
    expect(situacoesDoCliente(negocios, eventos, ETAPAS)).toEqual([]);
  });

  it('saiu do Jurídico a partir de uma etapa SEM marca: nada acende', () => {
    const eventos = [transferencia('e1', JURIDICO, ATIVO, COMERCIAL, '2026-09-29T20:00:00+00:00')];
    expect(situacoesDoCliente([card('c1', COMERCIAL, MQL)], eventos, ETAPAS)).toEqual([]);
  });

  it('vale a ÚLTIMA saída do funil, não a primeira', () => {
    const eventos = [
      transferencia('e1', JURIDICO, RESCINDIDO, COMERCIAL, '2025-05-01T12:00:00+00:00'),
      transferencia('e2', JURIDICO, ATIVO, COMERCIAL, '2026-09-29T12:00:00+00:00'),
    ];
    expect(situacoesDoCliente([card('c1', COMERCIAL, MQL)], eventos, ETAPAS)).toEqual([]);
    expect(situacoesDoCliente([card('c1', COMERCIAL, MQL)], [...eventos].reverse(), ETAPAS)).toEqual([]);
  });

  it('com card no funil, a etapa ATUAL vence qualquer saída antiga (a trilha retroativa da Kommo tem data histórica)', () => {
    const eventos = [transferencia('e1', JURIDICO, RESCINDIDO, COMERCIAL, '2026-12-31T00:00:00+00:00')];
    expect(situacoesDoCliente([card('c1', JURIDICO, ATIVO)], eventos, ETAPAS)).toEqual([]);
  });

  it('card apagado numa etapa marcada: a faixa fica (a pessoa continua tendo sido rescindida)', () => {
    const eventos: EventoDeSaida[] = [
      { id: 'e1', event_type: 'deal_deleted', from_pipeline_id: JURIDICO, from_stage_id: RESCINDIDO, to_pipeline_id: null, occurred_at: '2026-09-29T12:00:00+00:00' },
    ];
    expect(situacoesDoCliente([], eventos, ETAPAS).map((s) => s.situacao)).toEqual(['rescindido']);
  });

  it('mudança de etapa DENTRO do funil não é saída', () => {
    const eventos = [transferencia('e1', JURIDICO, RESCINDIDO, JURIDICO, '2026-09-29T12:00:00+00:00')];
    expect(situacoesDoCliente([], eventos, ETAPAS)).toEqual([]);
  });

  it('dois funis marcados: rescindido antes de finalizado', () => {
    const negocios = [card('c1', TRABALHISTA, ENCERRADO_TRAB)];
    const eventos = [transferencia('e1', JURIDICO, RESCINDIDO, COMERCIAL, '2026-09-29T12:00:00+00:00')];
    expect(situacoesDoCliente(negocios, eventos, ETAPAS).map((s) => [s.situacao, s.funil])).toEqual([
      ['rescindido', 'Bancário - Jurídico'],
      ['finalizado', 'Trabalhista - Jurídico'],
    ]);
  });

  it('card sem funil ou sem etapa não acende nada', () => {
    expect(situacoesDoCliente([card('c1', null, RESCINDIDO)], [], ETAPAS)).toEqual([]);
    expect(situacoesDoCliente([card('c1', JURIDICO, null)], [], ETAPAS)).toEqual([]);
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
    expect(sql).toContain(`CHECK (situacao_do_cliente IS NULL OR situacao_do_cliente IN (${lista}))`);
  });

  it('a coluna é aditiva e anulável (o app antigo não a manda)', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS situacao_do_cliente text;/);
    expect(sql).not.toMatch(/situacao_do_cliente text NOT NULL/);
    expect(sql).not.toMatch(/situacao_do_cliente text DEFAULT/);
  });
});

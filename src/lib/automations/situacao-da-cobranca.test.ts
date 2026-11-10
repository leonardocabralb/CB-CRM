import { describe, expect, it } from 'vitest';

import { montarVariaveis } from '@/lib/asaas/regua';
import type { ParcelaDoEspelho } from '@/lib/asaas/inadimplencia';

import { avaliarSituacaoDaCobranca, lerLimitesDaCobranca, problemaDosLimites } from './situacao-da-cobranca';

// A regra do operador (10/11/2026): "mais de 15 dias de atraso ou mais de uma
// parcela em atraso" → 2 parcelas OU 15 dias, "a partir de".
const REGRA = { cobranca_parcelas: 2, cobranca_dias: 15 };
const vars = (vencidas: number, dias: number) => ({ vencidas_quantidade: String(vencidas), dias_de_atraso_maior: String(dias) });

describe('avaliarSituacaoDaCobranca', () => {
  it('uma parcela com pouco atraso: não; duas parcelas: sim; uma com 15 dias: sim (o próprio dia 15 conta)', () => {
    expect(avaliarSituacaoDaCobranca(REGRA, vars(1, 1)).sim).toBe(false);
    expect(avaliarSituacaoDaCobranca(REGRA, vars(1, 14)).sim).toBe(false);
    expect(avaliarSituacaoDaCobranca(REGRA, vars(1, 15)).sim).toBe(true);
    expect(avaliarSituacaoDaCobranca(REGRA, vars(2, 1)).sim).toBe(true);
    expect(avaliarSituacaoDaCobranca(REGRA, vars(3, 40)).sim).toBe(true);
  });

  it('o registro diz o que leu', () => {
    expect(avaliarSituacaoDaCobranca(REGRA, vars(1, 1)).nota).toBe('1 parcela vencida, a mais antiga com 1 dia de atraso');
    expect(avaliarSituacaoDaCobranca(REGRA, vars(3, 40)).nota).toBe('3 parcelas vencidas, a mais antiga com 40 dias de atraso');
    expect(avaliarSituacaoDaCobranca(REGRA, vars(0, 0))).toEqual({ sim: false, nota: 'nenhuma parcela vencida' });
  });

  it('limite em branco não é olhado', () => {
    expect(avaliarSituacaoDaCobranca({ cobranca_parcelas: 2 }, vars(1, 300)).sim).toBe(false);
    expect(avaliarSituacaoDaCobranca({ cobranca_dias: 15 }, vars(5, 3)).sim).toBe(false);
    expect(avaliarSituacaoDaCobranca({}, vars(5, 300)).sim).toBe(false);
  });

  it('fora da régua (sem as vars da cobrança) responde não e diz por quê', () => {
    const r = avaliarSituacaoDaCobranca(REGRA, undefined);
    expect(r.sim).toBe(false);
    expect(r.nota).toContain('só a régua do Asaas');
    expect(avaliarSituacaoDaCobranca(REGRA, { vencidas_quantidade: 'muitas', dias_de_atraso_maior: '3' }).sim).toBe(false);
  });

  it('lê as vars que a régua REAL monta (montarVariaveis): o lembrete nunca bate', () => {
    const p = (extra: Partial<ParcelaDoEspelho>): ParcelaDoEspelho => ({
      id: 'x', asaas_payment_id: 'pay_x', asaas_customer_id: 'cus_x', status: 'OVERDUE', deleted: false, valor: 100, juros_e_multa: null,
      vencimento: '2026-11-01', vencimento_original: null, vista_vencida_em: null, pago_em: null, forma: 'BOLETO', pode_pagar_apos_vencimento: true,
      dias_ate_cancelar_registro: null, descricao: null, parcelamento_id: 'i', parcela_numero: 1, parcela_total: 3, link_fatura: null, link_boleto: null,
      visto_em: '2026-11-16T12:00:00Z', ...extra,
    });
    const agora = new Date('2026-11-16T12:00:00Z');
    const umaCom15 = montarVariaveis({ clienteNome: 'Maria', escritorioNome: 'CB', vencidas: [p({})], cruzaram: [p({})], venceHoje: [], hoje: '2026-11-16', agora });
    expect(avaliarSituacaoDaCobranca(REGRA, umaCom15).sim).toBe(true);
    const lembrete = montarVariaveis({ clienteNome: 'Maria', escritorioNome: 'CB', vencidas: [], cruzaram: [], venceHoje: [p({ status: 'PENDING', vencimento: '2026-11-16' }), p({ id: 'y', status: 'PENDING', vencimento: '2026-11-16' })], hoje: '2026-11-16', agora });
    expect(avaliarSituacaoDaCobranca(REGRA, lembrete).sim).toBe(false);
  });
});

describe('limites', () => {
  it('lerLimitesDaCobranca só aceita inteiro na faixa', () => {
    expect(lerLimitesDaCobranca(REGRA)).toEqual({ parcelas: 2, dias: 15 });
    expect(lerLimitesDaCobranca({ cobranca_parcelas: 0, cobranca_dias: 400 })).toEqual({ parcelas: null, dias: null });
    expect(lerLimitesDaCobranca({ cobranca_parcelas: '2', cobranca_dias: 1.5 })).toEqual({ parcelas: null, dias: null });
  });

  it('problemaDosLimites: nenhum limite, ou limite presente fora da forma', () => {
    expect(problemaDosLimites(REGRA)).toBe(null);
    expect(problemaDosLimites({ cobranca_dias: 30 })).toBe(null);
    expect(problemaDosLimites({})).toBe('sem_limite');
    expect(problemaDosLimites({ cobranca_parcelas: null, cobranca_dias: '' })).toBe('sem_limite');
    expect(problemaDosLimites({ cobranca_parcelas: 2, cobranca_dias: 0 })).toBe('limite_invalido');
    expect(problemaDosLimites({ cobranca_parcelas: '2' })).toBe('limite_invalido');
  });
});

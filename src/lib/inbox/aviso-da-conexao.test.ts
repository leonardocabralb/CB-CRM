import { describe, expect, it } from 'vitest';

import { toneFor, type EntradaDeCor } from '@/lib/cb-channels/health';
import { LIMIAR_ATRASO_SEG } from '@/lib/cb-channels/atraso-de-entrega';

import { avisoDaConexao, type SaudeDaConexao } from './aviso-da-conexao';

const BANCARIO: SaudeDaConexao = {
  id: 'canal-a',
  label: 'Bancário - Comercial',
  tone: 'ok',
  detail: null,
  atrasoSeg: null,
};

function aviso(c: Partial<SaudeDaConexao>, extra: Partial<Parameters<typeof avisoDaConexao>[0]> = {}) {
  return avisoDaConexao({
    canalId: 'canal-a',
    ehGrupo: false,
    saude: [{ ...BANCARIO, ...c }],
    carregando: false,
    falhou: false,
    ...extra,
  });
}

describe('avisoDaConexao', () => {
  it('fora do ar: o tom vermelho, com o nome da conexão', () => {
    expect(aviso({ tone: 'down', detail: 'closed' })).toEqual({
      tipo: 'fora_do_ar',
      rotulo: 'Bancário - Comercial',
    });
    expect(aviso({ tone: 'down', detail: 'disconnected' })?.tipo).toBe('fora_do_ar');
  });

  it('não recebe: o webhook não aponta para cá', () => {
    expect(aviso({ tone: 'warn', detail: 'webhook' })).toEqual({
      tipo: 'nao_recebe',
      rotulo: 'Bancário - Comercial',
    });
  });

  it('atrasada: leva o atraso em minutos', () => {
    expect(aviso({ tone: 'warn', detail: 'lagging', atrasoSeg: 1_740 })).toEqual({
      tipo: 'atrasada',
      rotulo: 'Bancário - Comercial',
      minutos: 29,
    });
  });

  it('atrasada sem medição não afirma "0 min" — cala', () => {
    expect(aviso({ tone: 'warn', detail: 'lagging', atrasoSeg: null })).toBeNull();
  });

  it('os amarelos transitórios não acendem faixa (piscariam a cada reconexão)', () => {
    for (const detail of ['pairing', 'stale', 'lastError']) {
      expect(aviso({ tone: 'warn', detail })).toBeNull();
    }
  });

  it('de pé, sem configuração ou sem a conexão na lista: nada', () => {
    expect(aviso({ tone: 'ok' })).toBeNull();
    expect(aviso({ tone: 'unknown', detail: 'incomplete' })).toBeNull();
    expect(aviso({ tone: 'down' }, { canalId: 'outra' })).toBeNull();
  });

  it('grupo: o número de SAÍDA fora do ar trava; o âmbar (entrada) não aparece', () => {
    // A entrada do grupo é o `cb_groups.channel_id`, outro número; e a
    // medição de atraso já deixa grupo de fora.
    expect(aviso({ tone: 'down' }, { ehGrupo: true })?.tipo).toBe('fora_do_ar');
    expect(aviso({ tone: 'warn', detail: 'webhook' }, { ehGrupo: true })).toBeNull();
    expect(aviso({ tone: 'warn', detail: 'lagging', atrasoSeg: 900 }, { ehGrupo: true })).toBeNull();
  });

  it('não sei qual conexão responde = nada', () => {
    expect(aviso({ tone: 'down' }, { canalId: null })).toBeNull();
  });

  it('sonda carregando ou que FALHOU nunca vira "fora do ar" (a lista pode ser a velha)', () => {
    expect(aviso({ tone: 'down' }, { carregando: true })).toBeNull();
    expect(aviso({ tone: 'down' }, { falhou: true })).toBeNull();
  });

  it('acompanha os motivos que o `toneFor` REALMENTE devolve', () => {
    // Renomear um motivo na régua do servidor apagaria a faixa em silêncio:
    // o tom e o motivo daqui saem do próprio `toneFor`, nunca digitados.
    const base: EntradaDeCor = {
      status: 'connected',
      estadoVivo: 'open',
      checkedAt: null,
      lastError: null,
      incompleto: false,
      webhookOk: null,
      atrasoSeg: null,
      atrasoMedidoEm: null,
      agoraMs: Date.parse('2026-10-05T13:00:00.000Z'),
    };
    const casos: [EntradaDeCor, string | null][] = [
      [{ ...base, estadoVivo: 'close' }, 'fora_do_ar'],
      [{ ...base, estadoVivo: null, status: 'disconnected' }, 'fora_do_ar'],
      [{ ...base, webhookOk: false }, 'nao_recebe'],
      [
        {
          ...base,
          atrasoSeg: LIMIAR_ATRASO_SEG + 60,
          atrasoMedidoEm: '2026-10-05T12:59:30.000Z',
        },
        'atrasada',
      ],
      [{ ...base, estadoVivo: 'connecting' }, null],
      [{ ...base }, null],
    ];
    for (const [entrada, esperado] of casos) {
      const { tone, detail } = toneFor(entrada);
      const r = aviso({ tone, detail, atrasoSeg: entrada.atrasoSeg });
      expect(r?.tipo ?? null).toBe(esperado);
    }
  });
});

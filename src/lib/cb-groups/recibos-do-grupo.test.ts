import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ehNumeroDaConta,
  gravarReciboDoGrupo,
  lerReciboDoGrupo,
  statusDoGrupo,
  type ReciboDoGrupo,
} from './recibos-do-grupo';

// Números, LIDs e ids FICTÍCIOS.
const GRUPO = '120363000000000000@g.us';
const AGORA = new Date('2026-11-04T19:00:00Z');

const aviso = (extra: Record<string, unknown> = {}) => ({
  keyId: '3EB0000000000000AB26',
  remoteJid: GRUPO,
  fromMe: true,
  participant: '100000000000001@lid',
  participantAlt: '5583900000001@s.whatsapp.net',
  reciboDoGrupo: 'DELIVERY_ACK',
  instante: 1793818464,
  instanceId: 'instancia-de-teste',
  ...extra,
});

describe('lerReciboDoGrupo — o aviso do 5º patch', () => {
  it('lê a entrega e a leitura, com o telefone do par do LID e o instante em segundos', () => {
    expect(lerReciboDoGrupo(aviso(), AGORA)).toEqual({
      keyId: '3EB0000000000000AB26',
      groupJid: GRUPO,
      participante: '100000000000001@lid',
      telefone: '5583900000001',
      lida: false,
      instante: new Date(1793818464 * 1000),
    });
    expect(lerReciboDoGrupo(aviso({ reciboDoGrupo: 'READ' }), AGORA)?.lida).toBe(true);
  });

  it('⚠️ o `messages.update` de sempre (com `status`, sem `reciboDoGrupo`) NÃO é recibo de grupo', () => {
    expect(lerReciboDoGrupo({ keyId: 'x', remoteJid: GRUPO, fromMe: true, status: 'DELIVERY_ACK' })).toBeNull();
    expect(lerReciboDoGrupo(aviso({ reciboDoGrupo: 'SERVER_ACK' }))).toBeNull();
    expect(lerReciboDoGrupo(null)).toBeNull();
  });

  it('só em grupo, com id e participante', () => {
    expect(lerReciboDoGrupo(aviso({ remoteJid: '5583900000009@s.whatsapp.net' }))).toBeNull();
    expect(lerReciboDoGrupo(aviso({ keyId: '' }))).toBeNull();
    expect(lerReciboDoGrupo(aviso({ participant: undefined }))).toBeNull();
    expect(lerReciboDoGrupo(aviso({ participant: 'sem-arroba' }))).toBeNull();
    expect(lerReciboDoGrupo(aviso({ participant: GRUPO }))).toBeNull();
  });

  it('o aparelho sai do participante (um recibo por aparelho é a mesma pessoa)', () => {
    expect(lerReciboDoGrupo(aviso({ participant: '100000000000001:12@lid' }))?.participante).toBe(
      '100000000000001@lid',
    );
  });

  it('⚠️ o LID jamais vira telefone; o telefone sai do JID de telefone ou do par', () => {
    expect(lerReciboDoGrupo(aviso({ participantAlt: undefined }))?.telefone).toBeNull();
    expect(lerReciboDoGrupo(aviso({ participantAlt: '100000000000009@lid' }))?.telefone).toBeNull();
    expect(
      lerReciboDoGrupo(aviso({ participant: '5583900000002:3@s.whatsapp.net', participantAlt: undefined }))
        ?.telefone,
    ).toBe('5583900000002');
  });

  it('instante fora da faixa (milissegundos, texto, ausente) vira agora', () => {
    expect(lerReciboDoGrupo(aviso({ instante: 1793818464000 }), AGORA)?.instante).toEqual(AGORA);
    expect(lerReciboDoGrupo(aviso({ instante: '1793818464' }), AGORA)?.instante).toEqual(AGORA);
    expect(lerReciboDoGrupo(aviso({ instante: undefined }), AGORA)?.instante).toEqual(AGORA);
  });
});

describe('ehNumeroDaConta — o recibo da outra conexão no mesmo grupo não conta', () => {
  const recibo = (r: Partial<ReciboDoGrupo>): ReciboDoGrupo => ({
    keyId: 'k',
    groupJid: GRUPO,
    participante: '100000000000001@lid',
    telefone: null,
    lida: false,
    instante: AGORA,
    ...r,
  });

  it('pelo LID aprendido da conexão (com ou sem aparelho)', () => {
    const conexoes = [{ own_lid: '100000000000001:7@lid', display_phone: null }];
    expect(ehNumeroDaConta(recibo({}), conexoes)).toBe(true);
  });

  it('⚠️ pelo telefone, quando o LID da conexão não foi aprendido (o caso da maioria)', () => {
    const conexoes = [{ own_lid: null, display_phone: '+55 83 90000-0001' }];
    expect(ehNumeroDaConta(recibo({ telefone: '5583900000001' }), conexoes)).toBe(true);
  });

  it('pela chave de pessoa: o nono dígito gravado diferente não engana', () => {
    const conexoes = [{ own_lid: null, display_phone: '5583999990001' }];
    expect(ehNumeroDaConta(recibo({ telefone: '558399990001' }), conexoes)).toBe(true);
  });

  it('o cliente não é número da conta', () => {
    const conexoes = [
      { own_lid: '100000000000009@lid', display_phone: '5583900000009' },
      { own_lid: null, display_phone: null },
    ];
    expect(ehNumeroDaConta(recibo({ telefone: '5583900000001' }), conexoes)).toBe(false);
    expect(ehNumeroDaConta(recibo({}), [])).toBe(false);
  });
});

describe('statusDoGrupo — como o WhatsApp: todos os de fora', () => {
  it('entregue quando todos receberam, lida quando todos leram', () => {
    expect(statusDoGrupo({ entregues: 1, lidas: 0, participantesDeFora: 2 })).toBeNull();
    expect(statusDoGrupo({ entregues: 2, lidas: 1, participantesDeFora: 2 })).toBe('delivered');
    expect(statusDoGrupo({ entregues: 2, lidas: 2, participantesDeFora: 2 })).toBe('read');
  });

  it('⚠️ sem denominador (grupo nunca conferido) a bolha fica em ✓', () => {
    expect(statusDoGrupo({ entregues: 5, lidas: 5, participantesDeFora: null })).toBeNull();
    expect(statusDoGrupo({ entregues: 5, lidas: 5, participantesDeFora: 0 })).toBeNull();
  });

  it('mais recibos que o denominador (alguém entrou depois da conferência) ainda conta como todos', () => {
    expect(statusDoGrupo({ entregues: 4, lidas: 0, participantesDeFora: 3 })).toBe('delivered');
  });
});

describe('gravarReciboDoGrupo — a chamada ao banco', () => {
  const recibo = lerReciboDoGrupo(aviso({ reciboDoGrupo: 'READ' }), AGORA)!;

  function banco(resposta: { data: unknown; error: { message: string } | null }) {
    const rpc = vi.fn(async () => resposta);
    return { db: { rpc } as unknown as SupabaseClient, rpc };
  }

  it('manda o recibo pela função e devolve a contagem', async () => {
    const { db, rpc } = banco({ data: [{ entregues: 2, lidas: 1, participantes_de_fora: 3 }], error: null });
    await expect(gravarReciboDoGrupo(db, 'conta-1', recibo)).resolves.toEqual({
      entregues: 2,
      lidas: 1,
      participantesDeFora: 3,
    });
    expect(rpc).toHaveBeenCalledWith('cb_registrar_recibo_do_grupo', {
      p_account_id: 'conta-1',
      p_group_jid: GRUPO,
      p_message_id: '3EB0000000000000AB26',
      p_participante: '100000000000001@lid',
      p_telefone: '5583900000001',
      p_lida: true,
      p_instante: new Date(1793818464 * 1000).toISOString(),
    });
  });

  it('denominador nulo continua nulo', async () => {
    const { db } = banco({ data: [{ entregues: 1, lidas: 0, participantes_de_fora: null }], error: null });
    await expect(gravarReciboDoGrupo(db, 'conta-1', recibo)).resolves.toEqual({
      entregues: 1,
      lidas: 0,
      participantesDeFora: null,
    });
  });

  it('erro ou resposta sem contagem vira nulo, sem lançar', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(gravarReciboDoGrupo(banco({ data: null, error: { message: 'x' } }).db, 'c', recibo)).resolves.toBeNull();
    await expect(gravarReciboDoGrupo(banco({ data: [], error: null }).db, 'c', recibo)).resolves.toBeNull();
    await expect(gravarReciboDoGrupo(banco({ data: [{ entregues: '2' }], error: null }).db, 'c', recibo)).resolves.toBeNull();
    erro.mockRestore();
  });
});

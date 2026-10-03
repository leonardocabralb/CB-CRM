import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  numeroDoAvisoDeConexao,
  numeroDoPareamento,
  registrarNumeroDoAviso,
  trocouDeNumero,
} from './troca-de-numero';

// ============================================================
// O "Reparear" leu o QR com OUTRO chip? (03/10/2026) — o número novo chega
// pela rota `/connect` e pelo aviso `connection.update`, e quando ele muda o
// `own_lid` é zerado para o CRM reaprender o do aparelho novo.
// ============================================================

describe('trocouDeNumero', () => {
  it('outro número: trocou', () => {
    expect(trocouDeNumero('559690000016', '559690000017')).toBe(true);
  });

  it('o mesmo número, com ou sem formatação: não trocou', () => {
    expect(trocouDeNumero('559690000016', '559690000016')).toBe(false);
    expect(trocouDeNumero('+55 (96) 9000-0016', '559690000016')).toBe(false);
  });

  it('sem o número agora (a Evolution não informou): não afirma troca', () => {
    expect(trocouDeNumero('559690000016', undefined)).toBe(false);
    expect(trocouDeNumero('559690000016', '')).toBe(false);
  });

  it('sem número antes: conta como troca (zerar um LID que já é nulo não custa nada)', () => {
    expect(trocouDeNumero(null, '559690000016')).toBe(true);
  });
});

describe('numeroDoPareamento — a linha de fetchInstances', () => {
  it('⚠️ aberta na memória, mas o status GRAVADO ainda não é open: o ownerJid é do chip ANTERIOR', () => {
    expect(
      numeroDoPareamento({ ownerJid: '559690000016@s.whatsapp.net', connectionStatus: 'connecting' }),
    ).toEqual({ pendente: true });
  });

  it('gravado open: vale o ownerJid, sem o aparelho', () => {
    expect(
      numeroDoPareamento({ ownerJid: '559690000017@s.whatsapp.net', connectionStatus: 'open' }),
    ).toEqual({ numero: '559690000017', pendente: false });
  });

  it('versão que não devolve o status: vale o ownerJid, como antes', () => {
    expect(numeroDoPareamento({ ownerJid: '559690000017@s.whatsapp.net' })).toEqual({
      numero: '559690000017',
      pendente: false,
    });
  });

  it('sem linha, ou ownerJid que não é telefone (LID): sem número, sem travar', () => {
    expect(numeroDoPareamento(undefined)).toEqual({ pendente: false });
    expect(numeroDoPareamento({ ownerJid: '123456789012345@lid', connectionStatus: 'open' })).toEqual({
      pendente: false,
    });
  });
});

describe('numeroDoAvisoDeConexao — o connection.update da Evolution', () => {
  it('aberta, com o wuid do telefone: o número', () => {
    expect(numeroDoAvisoDeConexao({ state: 'open', wuid: '559690000017@s.whatsapp.net' })).toBe('559690000017');
  });

  it('queda, LID, corpo sem wuid ou lixo: nada', () => {
    expect(numeroDoAvisoDeConexao({ state: 'close', wuid: '559690000017@s.whatsapp.net' })).toBeNull();
    expect(numeroDoAvisoDeConexao({ state: 'connecting' })).toBeNull();
    expect(numeroDoAvisoDeConexao({ state: 'open', wuid: '123456789012345@lid' })).toBeNull();
    expect(numeroDoAvisoDeConexao({ state: 'open' })).toBeNull();
    expect(numeroDoAvisoDeConexao(null)).toBeNull();
    expect(numeroDoAvisoDeConexao('open')).toBeNull();
  });
});

describe('registrarNumeroDoAviso', () => {
  function bancoQueGrava(resposta: { error: { message: string } | null } | Error) {
    const chamadas: { payload?: unknown; filtros: [string, ...unknown[]][] } = { filtros: [] };
    const b = {
      update: (payload: unknown) => ((chamadas.payload = payload), b),
      eq: (k: string, v: unknown) => (chamadas.filtros.push(['eq', k, v]), b),
      or: (expr: string) => {
        chamadas.filtros.push(['or', expr]);
        return resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta);
      },
    };
    const db = { from: (tabela: string) => (chamadas.filtros.push(['from', tabela]), b) };
    return { db: db as unknown as SupabaseClient, chamadas };
  }

  it('grava o número e zera o own_lid SÓ quando ele mudou — a condição vive no WHERE', async () => {
    const { db, chamadas } = bancoQueGrava({ error: null });
    await registrarNumeroDoAviso(db, 'comercial-a1b2c3', '559690000017');
    expect(chamadas.payload).toEqual({ display_phone: '559690000017', own_lid: null });
    expect(chamadas.filtros).toEqual([
      ['from', 'cb_channels'],
      ['eq', 'instance_name', 'comercial-a1b2c3'],
      ['eq', 'kind', 'evolution'],
      ['or', 'display_phone.is.null,display_phone.neq.559690000017'],
    ]);
  });

  it('nunca lança: erro devolvido e erro lançado viram log', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(
      registrarNumeroDoAviso(bancoQueGrava({ error: { message: 'duplicado' } }).db, 'x', '559690000017'),
    ).resolves.toBeUndefined();
    await expect(
      registrarNumeroDoAviso(bancoQueGrava(new Error('rede')).db, 'x', '559690000017'),
    ).resolves.toBeUndefined();
    expect(aviso).toHaveBeenCalledTimes(2);
    aviso.mockRestore();
  });
});

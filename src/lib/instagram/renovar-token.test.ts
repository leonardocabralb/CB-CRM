import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Fase 6: a renovação do token do Instagram. Ids e tokens fictícios.
// ============================================================

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => s.replace(/^cifrado:/, ''),
  encrypt: (s: string) => `cifrado:${s}`,
}));

import { InstagramApiError } from './graph';
import {
  MOTIVO_TOKEN_RECUSADO,
  renovarTokensDoInstagram,
} from './renovar-token';

const AGORA = new Date('2026-11-21T20:00:00Z');
const DIA = 86_400_000;
const em = (dias: number) =>
  new Date(AGORA.getTime() + dias * DIA).toISOString();

interface Escrita {
  valores: Record<string, unknown>;
  filtros: [string, string, unknown][];
}

function fakeAdmin(opcoes: {
  canais: Record<string, unknown>[];
  erroDaLeitura?: string;
  linhasGravadas?: number;
}) {
  const escritas: Escrita[] = [];
  const leitura: [string, unknown][] = [];
  const from = () => {
    let escrita: Escrita | null = null;
    const b = {
      select: () => b,
      update: (valores: Record<string, unknown>) => {
        escrita = { valores, filtros: [] };
        escritas.push(escrita);
        return b;
      },
      eq: (c: string, v: unknown) => {
        if (escrita) escrita.filtros.push(['eq', c, v]);
        else leitura.push([c, v]);
        return b;
      },
      is: (c: string, v: unknown) => {
        escrita?.filtros.push(['is', c, v]);
        return b;
      },
      not: () => b,
      or: (f: string) => {
        leitura.push(['or', f]);
        return b;
      },
      limit: () => b,
      then: (ok: (v: unknown) => unknown) => {
        if (escrita) {
          const n = opcoes.linhasGravadas ?? 1;
          return Promise.resolve({
            data: Array.from({ length: n }, () => ({ id: 'x' })),
            error: null,
          }).then(ok);
        }
        return Promise.resolve(
          opcoes.erroDaLeitura
            ? { data: null, error: { message: opcoes.erroDaLeitura } }
            : { data: opcoes.canais, error: null }
        ).then(ok);
      },
    };
    return b;
  };
  return { admin: { from } as unknown as SupabaseClient, escritas, leitura };
}

const CANAL = {
  id: 'ch-ig',
  access_token: 'cifrado:IGAAvelho',
  ig_token_expires_at: em(30),
  ig_token_refreshed_at: em(-30),
};

const renovar = vi.fn();

beforeEach(() => {
  renovar.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('renovarTokensDoInstagram', () => {
  it('lê só conexões do Instagram conectadas, renovadas há 7 dias ou mais', async () => {
    const { admin, leitura } = fakeAdmin({ canais: [] });
    await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(leitura).toContainEqual(['kind', 'instagram']);
    expect(leitura).toContainEqual(['status', 'connected']);
    expect(leitura).toContainEqual([
      'or',
      `ig_token_refreshed_at.is.null,ig_token_refreshed_at.lt.${em(-7)}`,
    ]);
  });

  it('renova: grava o token novo CIFRADO, o vencimento MEDIDO e o carimbo, cercado pelo carimbo lido', async () => {
    renovar.mockResolvedValue({ token: 'IGAAnovo', expiraEmSeg: 60 * 86_400 });
    const { admin, escritas } = fakeAdmin({ canais: [CANAL] });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(renovar).toHaveBeenCalledWith('IGAAvelho');
    expect(r).toMatchObject({ renovados: 1, falhas: 0, desconectadas: 0 });
    expect(escritas[0].valores).toMatchObject({
      access_token: 'cifrado:IGAAnovo',
      ig_token_expires_at: em(60),
      ig_token_refreshed_at: AGORA.toISOString(),
    });
    expect(escritas[0].filtros).toContainEqual([
      'eq',
      'ig_token_refreshed_at',
      CANAL.ig_token_refreshed_at,
    ]);
  });

  it('⚠️ 200 sem estender o prazo NÃO é renovação: nada é gravado', async () => {
    renovar.mockResolvedValue({ token: 'IGAAvelho', expiraEmSeg: 29 * 86_400 });
    const { admin, escritas } = fakeAdmin({ canais: [CANAL] });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(r).toMatchObject({ renovados: 0, falhas: 1 });
    expect(escritas).toEqual([]);
  });

  it('reconectaram no meio (zero linhas pela cerca): não conta como renovado', async () => {
    renovar.mockResolvedValue({ token: 'IGAAnovo', expiraEmSeg: 60 * 86_400 });
    const { admin } = fakeAdmin({ canais: [CANAL], linhasGravadas: 0 });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(r.renovados).toBe(0);
  });

  it('token RECUSADO (190): a conexão fica desconectada, com o motivo', async () => {
    renovar.mockRejectedValue(
      new InstagramApiError('token_invalido', 'bad', 400, 190)
    );
    const { admin, escritas } = fakeAdmin({ canais: [CANAL] });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(r).toMatchObject({ desconectadas: 1, falhas: 1 });
    expect(escritas[0].valores).toMatchObject({
      status: 'disconnected',
      last_error: MOTIVO_TOKEN_RECUSADO,
    });
  });

  it('rede, limite e erro da Meta: nada muda, tenta no próximo ciclo', async () => {
    for (const err of [
      new InstagramApiError('rede', 'timeout'),
      new InstagramApiError('limite', 'slow down', 429),
      new InstagramApiError('meta_error', 'boom', 500),
    ]) {
      renovar.mockRejectedValueOnce(err);
      const { admin, escritas } = fakeAdmin({ canais: [CANAL] });
      const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
      expect(r).toMatchObject({ renovados: 0, falhas: 1, desconectadas: 0 });
      expect(escritas).toEqual([]);
    }
  });

  it('token já vencido não é renovado (a Meta recusaria): fica para quem reconectar', async () => {
    const { admin } = fakeAdmin({
      canais: [{ ...CANAL, ig_token_expires_at: em(-1) }],
    });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(renovar).not.toHaveBeenCalled();
    expect(r.renovados).toBe(0);
  });

  it('leitura que falha devolve o erro e não lança', async () => {
    const { admin } = fakeAdmin({ canais: [], erroDaLeitura: 'boom' });
    await expect(
      renovarTokensDoInstagram(admin, AGORA, renovar)
    ).resolves.toMatchObject({
      erro: 'boom',
    });
  });

  it('o token nunca aparece no log', async () => {
    const erro = vi.spyOn(console, 'error');
    renovar.mockRejectedValue(
      new InstagramApiError('meta_error', 'falhou sem segredo', 500)
    );
    const { admin } = fakeAdmin({ canais: [CANAL] });
    await renovarTokensDoInstagram(admin, AGORA, renovar);
    for (const chamada of erro.mock.calls) {
      expect(chamada.join(' ')).not.toContain('IGAAvelho');
    }
  });
});

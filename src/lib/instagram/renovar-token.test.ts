import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// Fase 6: a renovação do token do Instagram. Ids e tokens fictícios.
// ============================================================

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (s: string) => {
    if (s === 'quebrado') throw new Error('não decifra');
    return s.replace(/^cifrado:/, '');
  },
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
  /** O carimbo da tentativa (1152) não grava. */
  erroDoCarimbo?: string;
}) {
  // `escritas` é o TRABALHO (token novo, desconectada); o carimbo da
  // tentativa, que vem antes de todo pedido, fica à parte em `carimbos`.
  const escritas: Escrita[] = [];
  const carimbos: Escrita[] = [];
  const leitura: [string, unknown][] = [];
  const from = () => {
    let escrita: Escrita | null = null;
    const b = {
      select: () => b,
      update: (valores: Record<string, unknown>) => {
        escrita = { valores, filtros: [] };
        if ('ig_token_refresh_tried_at' in valores) carimbos.push(escrita);
        else escritas.push(escrita);
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
      order: (c: string) => {
        leitura.push(['order', c]);
        return b;
      },
      then: (ok: (v: unknown) => unknown) => {
        if (escrita && 'ig_token_refresh_tried_at' in escrita.valores) {
          return Promise.resolve(
            opcoes.erroDoCarimbo
              ? { data: null, error: { message: opcoes.erroDoCarimbo } }
              : { data: null, error: null }
          ).then(ok);
        }
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
  return { admin: { from } as unknown as SupabaseClient, escritas, carimbos, leitura };
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
    // Só o login do Instagram tem token de 60 dias: o do unificado não vence,
    // e o refresh do graph.instagram.com o recusaria com 190 (1153).
    expect(leitura).toContainEqual(['ig_login', 'instagram']);
    expect(leitura).toContainEqual(['status', 'connected']);
    expect(leitura).toContainEqual([
      'or',
      `ig_token_refreshed_at.is.null,ig_token_refreshed_at.lt.${em(-7)}`,
    ]);
    // ⚠️ O vencido sai NO BANCO, antes do limite (Codex, PR #539).
    expect(leitura).toContainEqual([
      'or',
      `ig_token_expires_at.is.null,ig_token_expires_at.gt.${AGORA.toISOString()}`,
    ]);
    expect(leitura).toContainEqual(['order', 'ig_token_expires_at']);
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
    // Cercada pelo carimbo lido, como a renovação (Codex, PR #539).
    expect(escritas[0].filtros).toContainEqual([
      'eq',
      'ig_token_refreshed_at',
      CANAL.ig_token_refreshed_at,
    ]);
  });

  it('⚠️ reconectaram enquanto o pedido estava no ar: o 190 atrasado NÃO desconecta a conta nova', async () => {
    renovar.mockRejectedValue(
      new InstagramApiError('token_invalido', 'bad', 400, 190)
    );
    // A cerca não casa: a reconexão avançou o carimbo.
    const { admin } = fakeAdmin({ canais: [CANAL], linhasGravadas: 0 });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(r.desconectadas).toBe(0);
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

describe('rodízio: a tentativa é carimbada ANTES do pedido (1152, revisão do PR #539)', () => {
  it('o lote começa pela tentada há mais tempo, e só depois pela validade', async () => {
    const { admin, leitura } = fakeAdmin({ canais: [] });
    await renovarTokensDoInstagram(admin, AGORA, renovar);
    const ordens = leitura.filter(([c]) => c === 'order').map(([, v]) => v);
    expect(ordens).toEqual(['ig_token_refresh_tried_at', 'ig_token_expires_at']);
  });

  it('carimba a conexão antes de pedir à Meta, mesmo quando o pedido falha', async () => {
    const ordem: string[] = [];
    const { admin, carimbos } = fakeAdmin({ canais: [CANAL] });
    renovar.mockImplementation(async () => {
      ordem.push(`pedido com ${carimbos.length} carimbo(s)`);
      throw new InstagramApiError('meta_error', 'falhou', 500);
    });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(ordem).toEqual(['pedido com 1 carimbo(s)']);
    expect(carimbos[0].valores).toEqual({ ig_token_refresh_tried_at: AGORA.toISOString() });
    expect(carimbos[0].filtros).toContainEqual(['eq', 'id', 'ch-ig']);
    expect(carimbos[0].filtros).toContainEqual(['eq', 'kind', 'instagram']);
    expect(r.falhas).toBe(1);
  });

  it('o token que não decifra também é carimbado (senão voltaria à frente em todo ciclo)', async () => {
    const { admin, carimbos } = fakeAdmin({ canais: [{ ...CANAL, access_token: 'quebrado' }] });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(carimbos).toHaveLength(1);
    expect(renovar).not.toHaveBeenCalled();
    expect(r.falhas).toBe(1);
  });

  it('conexão sem token: não há o que tentar, nem carimbo', async () => {
    const { admin, carimbos } = fakeAdmin({ canais: [{ ...CANAL, access_token: null }] });
    await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(carimbos).toEqual([]);
    expect(renovar).not.toHaveBeenCalled();
  });

  it('sem carimbo, sem pedido: o banco que não grava isso não gravaria o token novo', async () => {
    const { admin, escritas } = fakeAdmin({ canais: [CANAL], erroDoCarimbo: 'banco fora do ar' });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar);
    expect(renovar).not.toHaveBeenCalled();
    expect(escritas).toEqual([]);
    expect(r).toMatchObject({ renovados: 0, falhas: 1, desconectadas: 0 });
  });

  it('vencido e prazo esgotado não são carimbados: não houve tentativa', async () => {
    const vencido = fakeAdmin({ canais: [{ ...CANAL, ig_token_expires_at: em(-1) }] });
    await renovarTokensDoInstagram(vencido.admin, AGORA, renovar);
    expect(vencido.carimbos).toEqual([]);
    const semPrazo = fakeAdmin({ canais: [CANAL] });
    await renovarTokensDoInstagram(semPrazo.admin, AGORA, renovar, 5_000, () => 0);
    expect(semPrazo.carimbos).toEqual([]);
  });
});

describe('o prazo comum da manutenção (Codex, PR #539)', () => {
  it('não COMEÇA pedido que não cabe no prazo: o resto renova no próximo ciclo', async () => {
    renovar.mockResolvedValue({ token: 'IGAAnovo', expiraEmSeg: 60 * 86_400 });
    const outro = { ...CANAL, id: 'ch-ig-2' };
    const { admin } = fakeAdmin({ canais: [CANAL, outro] });
    // O relógio anda 9 s por pedido; o prazo deixa caber só o primeiro.
    let agora = 0;
    const relogio = () => agora;
    renovar.mockImplementation(async () => {
      agora += 9_000;
      return { token: 'IGAAnovo', expiraEmSeg: 60 * 86_400 };
    });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar, 15_000, relogio);
    expect(renovar).toHaveBeenCalledTimes(1);
    expect(r.renovados).toBe(1);
  });

  it('prazo já vencido: nenhum pedido', async () => {
    const { admin } = fakeAdmin({ canais: [CANAL] });
    const r = await renovarTokensDoInstagram(admin, AGORA, renovar, 5_000, () => 0);
    expect(renovar).not.toHaveBeenCalled();
    expect(r.renovados).toBe(0);
  });
});

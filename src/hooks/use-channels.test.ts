import { describe, it, expect } from 'vitest';

import { resultadoDaResposta } from './use-channels';

// ============================================================
// #06 — as TRÊS formas de a busca de canais falhar, e a que não falha.
//
// O ponto do teste é o `unavailable: true`: a rota devolve **200** com
// lista vazia quando o banco falha (o ramo pré-migration casa qualquer
// mensagem com "cb_channels" dentro — um `permission denied` do PostgREST
// entra ali). Antes do campo `falhou`, esse 200-com-erro era indistinguível
// de "a conta não tem canal", e o fio travava o compositor da conta
// Evolution com "Sessão expirada — use um modelo".
// ============================================================

describe('resultadoDaResposta (#06)', () => {
  it('não-200 é falha, nunca "conta sem canal"', () => {
    expect(resultadoDaResposta(false, null)).toEqual({
      channels: [],
      falhou: true,
    });
  });

  it('200 com `unavailable: true` é falha — o caminho 200-com-erro da rota', () => {
    expect(
      resultadoDaResposta(true, { channels: [], unavailable: true }),
    ).toEqual({ channels: [], falhou: true });
  });

  it('200 com corpo torto (sem array) é falha, não lista vazia', () => {
    expect(resultadoDaResposta(true, null)).toEqual({
      channels: [],
      falhou: true,
    });
    expect(resultadoDaResposta(true, { channels: 'nada' })).toEqual({
      channels: [],
      falhou: true,
    });
  });

  it('200 com lista (vazia inclusive) é RESPOSTA: falhou=false', () => {
    const canais = [{ id: 'c1' }];
    expect(resultadoDaResposta(true, { channels: canais })).toEqual({
      channels: canais,
      falhou: false,
    });
    // Vazio-COM-resposta é conhecimento ("a conta não tem canal"), não
    // lacuna — a distinção é a feature inteira (CLAUDE.md, PR #81).
    expect(resultadoDaResposta(true, { channels: [] })).toEqual({
      channels: [],
      falhou: false,
    });
  });
});

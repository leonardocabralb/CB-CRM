import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MOTIVOS_DO_OAUTH, motivoDoOAuth } from './conexao';

// ============================================================
// A volta do login do Instagram chega à tela como `?motivo=<x>`, e o painel
// pede a frase por chave MONTADA (`instagramOauthError_${motivo}`). Chave
// montada está fora do alcance do portão de i18n do CI (o mesmo buraco de
// `rotulo-da-secao.test.ts`): sem este teste, um motivo novo sem frase
// mostraria `Settings.channels.instagramOauthError_x` cru na tela, justo no
// momento em que o operador precisa saber por que a conexão falhou.
// ============================================================

function chavesDoDicionario(arquivo: string): Record<string, unknown> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'));
  return bruto.Settings.channels;
}

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const channels = chavesDoDicionario(arquivo);

  it('CRÍTICO: todo motivo do OAuth tem frase', () => {
    const semFrase = MOTIVOS_DO_OAUTH.filter(
      (m) => typeof channels[`instagramOauthError_${m}`] !== 'string'
    );
    expect(semFrase).toEqual([]);
  });

  it('não sobra frase de motivo que não existe', () => {
    const conhecidos = new Set<string>(
      MOTIVOS_DO_OAUTH.map((m) => `instagramOauthError_${m}`)
    );
    expect(
      Object.keys(channels).filter(
        (k) => k.startsWith('instagramOauthError_') && !conhecidos.has(k)
      )
    ).toEqual([]);
  });
});

describe('motivoDoOAuth', () => {
  it('motivo desconhecido na URL vira `erro`, nunca chave crua', () => {
    expect(motivoDoOAuth('recusado')).toBe('recusado');
    expect(motivoDoOAuth('x')).toBe('erro');
    expect(motivoDoOAuth(null)).toBe('erro');
  });
});

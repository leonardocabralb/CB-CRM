import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { NOME_PADRAO, NOME_CURTO_PADRAO, PECAS_DA_MARCA } from '@/lib/marca';

import { CODIGOS_DE_ERRO } from './rascunho';

// ============================================================
// As chaves MONTADAS da aba Marca (`pecas.<peca>.<campo>`, `erros.<codigo>`)
// escapam do portão de i18n do CI: sem este teste, peça ou código novo
// aparece cru na tela com o CI verde. As listas vêm do CÓDIGO
// (`PECAS_DA_MARCA`, `CODIGOS_DE_ERRO`), nunca digitadas aqui.
// ============================================================

const CAMPOS_DA_PECA = ['titulo', 'pc', 'celular', 'formato'] as const;

function marcaDoDicionario(arquivo: string): Record<string, unknown> {
  const bruto = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8'));
  return bruto.Settings.marca;
}

describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  const marca = marcaDoDicionario(arquivo);

  it('CRÍTICO: toda peça tem título, onde aparece e formato', () => {
    const pecas = marca.pecas as Record<string, Record<string, unknown>>;
    const faltando = PECAS_DA_MARCA.flatMap((p) =>
      CAMPOS_DA_PECA.filter((c) => typeof pecas?.[p]?.[c] !== 'string').map(
        (c) => `${p}.${c}`
      )
    );
    expect(faltando).toEqual([]);
  });

  it('CRÍTICO: todo código de erro da rota tem frase', () => {
    const erros = marca.erros as Record<string, unknown>;
    expect(
      CODIGOS_DE_ERRO.filter((c) => typeof erros?.[c] !== 'string')
    ).toEqual([]);
  });

  it('nenhuma frase cita o nome do produto (vai por {nomePadrao})', () => {
    const texto = JSON.stringify(marca);
    expect(texto).not.toContain(NOME_PADRAO);
    expect(texto).not.toContain(NOME_CURTO_PADRAO);
  });
});

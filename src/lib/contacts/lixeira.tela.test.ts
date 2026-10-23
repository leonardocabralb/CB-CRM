import { describe, expect, it } from 'vitest';

import {
  MOTIVOS_DA_LIXEIRA,
  TIPOS_DE_RESSALVA,
  lerArquivosParados,
  motivoDoCodigo,
  somarRessalvas,
  type ItemDaVolta,
  type Ressalva,
} from './lixeira';

// ============================================================
// As peças da Lixeira (1097) que a TELA usa: as listas das chaves montadas,
// o resumo das ressalvas de várias restaurações e a fila de arquivos.
// Dados fictícios.
// ============================================================

function volta(itemId: string, ressalvas: Ressalva[]): ItemDaVolta {
  return {
    itemId,
    contactId: `c-${itemId}`,
    resultado: 'restaurada',
    motivo: null,
    ocupadaPor: null,
    ocupadaPorNome: null,
    ressalvas,
  };
}

describe('MOTIVOS_DA_LIXEIRA', () => {
  it('cobre todo motivo que motivoDoCodigo devolve (sem repetir)', () => {
    const devolvidos = new Set([
      motivoDoCodigo('identidade_ocupada', null),
      motivoDoCodigo('em_processamento', null),
      motivoDoCodigo(null, 'membro_suspenso'),
      motivoDoCodigo('42501', 'so_admin'),
      motivoDoCodigo('P0001', 'lixeira_schema_mudou:contacts'),
      motivoDoCodigo('P0001', 'lixeira_sem_tratamento:x'),
      motivoDoCodigo('55P03', null),
      motivoDoCodigo('23503', null),
      motivoDoCodigo('57014', null),
      motivoDoCodigo('XX000', 'outra coisa'),
    ]);
    for (const m of devolvidos) expect(MOTIVOS_DA_LIXEIRA).toContain(m);
    expect(new Set(MOTIVOS_DA_LIXEIRA).size).toBe(MOTIVOS_DA_LIXEIRA.length);
    expect(MOTIVOS_DA_LIXEIRA).toHaveLength(10);
  });
});

describe('somarRessalvas', () => {
  it('soma por tipo, na ordem de TIPOS_DE_RESSALVA, e cala os zeros', () => {
    const r = somarRessalvas([
      volta('a', [
        { tipo: 'colunas_sumidas', n: 1 },
        { tipo: 'agendadas_em_falha', n: 2 },
      ]),
      volta('b', [{ tipo: 'agendadas_em_falha', n: 1 }]),
      volta('c', []),
    ]);
    expect(r).toEqual([
      { tipo: 'agendadas_em_falha', n: 3 },
      { tipo: 'colunas_sumidas', n: 1 },
    ]);
    expect(TIPOS_DE_RESSALVA.indexOf('agendadas_em_falha')).toBeLessThan(
      TIPOS_DE_RESSALVA.indexOf('colunas_sumidas'),
    );
  });

  it('assinaturas do ZapSign sem ficha são da CONTA: o maior, nunca a soma do lote', () => {
    const r = somarRessalvas([
      volta('a', [{ tipo: 'zapsign_sem_contato', n: 2 }]),
      volta('b', [{ tipo: 'zapsign_sem_contato', n: 2 }]),
      volta('c', [{ tipo: 'zapsign_sem_contato', n: 1 }]),
    ]);
    expect(r).toEqual([{ tipo: 'zapsign_sem_contato', n: 2 }]);
  });

  it('nenhuma volta, nenhuma ressalva', () => {
    expect(somarRessalvas([])).toEqual([]);
  });
});

describe('lerArquivosParados', () => {
  it('lê a fila e os parados', () => {
    expect(lerArquivosParados({ na_fila: 4, parados: 2 })).toEqual({ naFila: 4, parados: 2 });
    expect(lerArquivosParados({ na_fila: 0, parados: 0 })).toEqual({ naFila: 0, parados: 0 });
  });

  it('forma inesperada é NULO (a tela não afirma "nada parado")', () => {
    expect(lerArquivosParados(null)).toBeNull();
    expect(lerArquivosParados([])).toBeNull();
    expect(lerArquivosParados({ na_fila: 3 })).toBeNull();
    expect(lerArquivosParados({ parados: 3 })).toBeNull();
  });
});

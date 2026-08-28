import { describe, expect, it } from 'vitest';

import {
  ehDataValida,
  ehUuid,
  MAX_DESCRICAO,
  MAX_TITULO,
  normalizarDescricao,
  normalizarHora,
  normalizarTitulo,
} from './validar';

describe('ehDataValida', () => {
  it('aceita data real', () => {
    expect(ehDataValida('2026-08-28')).toBe(true);
    expect(ehDataValida('2026-02-28')).toBe(true);
    expect(ehDataValida('2026-12-31')).toBe(true);
  });

  it('recusa dia que não existe no mês', () => {
    // ⚠️ O caso que a regex sozinha deixa passar. Sem a volta pelo `Date`,
    // isto chegaria ao Postgres e voltaria como 22008 → "erro interno" na
    // tela de quem está justamente tentando corrigir a data.
    expect(ehDataValida('2026-02-31')).toBe(false);
    expect(ehDataValida('2026-04-31')).toBe(false);
    expect(ehDataValida('2026-06-31')).toBe(false);
  });

  it('recusa mês fora da faixa', () => {
    expect(ehDataValida('2026-13-01')).toBe(false);
    expect(ehDataValida('2026-00-10')).toBe(false);
  });

  it('recusa dia zero', () => {
    expect(ehDataValida('2026-08-00')).toBe(false);
  });

  it('recusa formato errado', () => {
    expect(ehDataValida('28/08/2026')).toBe(false);
    expect(ehDataValida('2026-8-5')).toBe(false); // sem zero à esquerda
    expect(ehDataValida('2026-08-28T10:00:00Z')).toBe(false);
    expect(ehDataValida('')).toBe(false);
  });

  it('recusa o que não é string', () => {
    expect(ehDataValida(null)).toBe(false);
    expect(ehDataValida(undefined)).toBe(false);
    expect(ehDataValida(20260828)).toBe(false);
  });
});

describe('bissexto', () => {
  it('aceita 29/02 em ano bissexto e recusa fora dele', () => {
    expect(ehDataValida('2028-02-29')).toBe(true);
    expect(ehDataValida('2027-02-29')).toBe(false);
    // Século não divisível por 400 não é bissexto — o `Date` sabe, a regex não.
    expect(ehDataValida('2100-02-29')).toBe(false);
    expect(ehDataValida('2000-02-29')).toBe(true);
  });
});

describe('normalizarHora', () => {
  it('aceita HH:MM e devolve HH:MM:SS', () => {
    expect(normalizarHora('09:30')).toBe('09:30:00');
    expect(normalizarHora('23:59')).toBe('23:59:00');
  });

  it('aceita HH:MM:SS de volta do banco', () => {
    expect(normalizarHora('14:05:30')).toBe('14:05:30');
  });

  it('vazio é null — tarefa sem hora é caso legítimo', () => {
    expect(normalizarHora(null)).toBeNull();
    expect(normalizarHora(undefined)).toBeNull();
    expect(normalizarHora('')).toBeNull();
  });

  it('malformado é undefined, não null', () => {
    // ⚠️ A distinção é load-bearing: colapsar os dois faria uma hora digitada
    // errado virar, em silêncio, uma tarefa sem hora.
    expect(normalizarHora('25:00')).toBeUndefined();
    expect(normalizarHora('10:75')).toBeUndefined();
    expect(normalizarHora('9:30')).toBeUndefined();
    expect(normalizarHora('manhã')).toBeUndefined();
    expect(normalizarHora(930)).toBeUndefined();
  });

  it('recusa segundo fora da faixa', () => {
    expect(normalizarHora('10:30:99')).toBeUndefined();
  });
});

describe('normalizarTitulo', () => {
  it('apara os espaços', () => {
    expect(normalizarTitulo('  Ligar para o cliente  ')).toBe('Ligar para o cliente');
  });

  it('recusa título só de espaço', () => {
    // ⚠️ O CHECK do banco é `btrim(titulo) <> ''`; sem o trim aqui, isto
    // passaria pelo teste de "string não vazia" e estouraria no insert.
    expect(normalizarTitulo('   ')).toBeUndefined();
    expect(normalizarTitulo('')).toBeUndefined();
  });

  it('recusa acima do teto', () => {
    expect(normalizarTitulo('a'.repeat(MAX_TITULO))).toHaveLength(MAX_TITULO);
    expect(normalizarTitulo('a'.repeat(MAX_TITULO + 1))).toBeUndefined();
  });

  it('recusa o que não é string', () => {
    expect(normalizarTitulo(null)).toBeUndefined();
    expect(normalizarTitulo(42)).toBeUndefined();
  });
});

describe('normalizarDescricao', () => {
  it('ausente e vazia viram null', () => {
    expect(normalizarDescricao(undefined)).toBeNull();
    expect(normalizarDescricao(null)).toBeNull();
    expect(normalizarDescricao('')).toBeNull();
    expect(normalizarDescricao('   ')).toBeNull();
  });

  it('apara e mantém', () => {
    expect(normalizarDescricao('  detalhe  ')).toBe('detalhe');
  });

  it('recusa acima do teto', () => {
    expect(normalizarDescricao('a'.repeat(MAX_DESCRICAO + 1))).toBeUndefined();
  });
});

describe('ehUuid', () => {
  it('aceita uuid e recusa o resto', () => {
    expect(ehUuid('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(true);
    expect(ehUuid('nao-e-uuid')).toBe(false);
    expect(ehUuid('')).toBe(false);
    expect(ehUuid(null)).toBe(false);
  });
});

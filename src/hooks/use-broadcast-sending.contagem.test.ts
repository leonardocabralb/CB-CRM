import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { contarPublico, type AudienceConfig } from './use-broadcast-sending';

// ============================================================
// A contagem do público (passo 2 e passo 4 do disparo) é a MESMA resolução
// do envio — Fase 3-IV do plano do merge do upstream (#594 do original).
//
// Até 23/09/2026 as duas telas tinham leitura própria, sem paginar: o
// PostgREST corta em 1.000 linhas sem avisar, e as etiquetas "kommo"
// (4.635 contatos), "Trabalhista" (3.611) e "Cliente Fechado" (1.081)
// apareciam como 1.000. O passo 4 ainda ignorava as exclusões e dizia 0
// para público por campo personalizado — o número que a confirmação mostra
// antes de um disparo pago. O envio, que pagina, saía para o número certo.
// ============================================================

type Linha = Record<string, unknown>;

/**
 * Banco falso que APLICA os filtros e pagina como o PostgREST: `range`
 * devolve no máximo a fatia pedida e `count` é o total filtrado. Sem aplicar
 * os filtros, um mutante que tirasse o `.in()` passaria verde (a lição do
 * `storage.exists()`).
 */
function bancoFalso(tabelas: Record<string, Linha[]>, falhaEm?: string) {
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      const consulta = {
        select: () => consulta,
        in(coluna: string, valores: unknown[]) {
          linhas = linhas.filter((l) => valores.includes(l[coluna]));
          return consulta;
        },
        eq(coluna: string, valor: unknown) {
          linhas = linhas.filter((l) => l[coluna] === valor);
          return consulta;
        },
        neq(coluna: string, valor: unknown) {
          linhas = linhas.filter((l) => l[coluna] !== valor);
          return consulta;
        },
        ilike(coluna: string, padrao: string) {
          const agulha = padrao.replace(/%/g, '').toLowerCase();
          linhas = linhas.filter((l) => String(l[coluna] ?? '').toLowerCase().includes(agulha));
          return consulta;
        },
        order(coluna: string) {
          linhas.sort((a, b) => String(a[coluna]).localeCompare(String(b[coluna])));
          return consulta;
        },
        range(de: number, ate: number) {
          if (falhaEm === tabela) {
            return Promise.resolve({ data: null, error: { message: 'falhou' }, count: null });
          }
          return Promise.resolve({
            data: linhas.slice(de, ate + 1),
            error: null,
            count: linhas.length,
          });
        },
      };
      return consulta;
    },
  } as unknown as Parameters<typeof contarPublico>[0];
}

const id = (prefixo: string, n: number) => `${prefixo}-${String(n).padStart(5, '0')}`;

/** 2.500 fichas com telefone, 3 só do Instagram (telefone nulo). */
function base() {
  const contacts: Linha[] = [];
  for (let n = 0; n < 2500; n++) contacts.push({ id: id('c', n), phone: `55819${n}` });
  for (let n = 0; n < 3; n++) contacts.push({ id: id('ig', n), phone: null });

  const contactTags: Linha[] = [];
  let tagRow = 0;
  // "grande": as 2.500 com telefone + as 3 do Instagram.
  for (const c of contacts) contactTags.push({ id: id('t', tagRow++), tag_id: 'grande', contact_id: c.id });
  // "instagram": só as 3 sem telefone.
  for (let n = 0; n < 3; n++) {
    contactTags.push({ id: id('t', tagRow++), tag_id: 'instagram', contact_id: id('ig', n) });
  }
  // "excluir": 1.200 das 2.500 (mais que uma página).
  for (let n = 0; n < 1200; n++) {
    contactTags.push({ id: id('t', tagRow++), tag_id: 'excluir', contact_id: id('c', n) });
  }

  const valores: Linha[] = [];
  for (let n = 0; n < 1500; n++) {
    valores.push({ id: id('v', n), custom_field_id: 'area', contact_id: id('c', n), value: n < 1100 ? 'Bancário' : 'Trabalhista' });
  }
  return { contacts, contact_tags: contactTags, contact_custom_values: valores };
}

describe('contarPublico: a contagem das telas é a resolução do envio', () => {
  it('etiqueta com mais de 1.000 contatos conta TODOS (era 1.000)', async () => {
    const aud: AudienceConfig = { type: 'tags', tagIds: ['grande'] };
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(2500);
  });

  it('a ficha só do Instagram fica de fora, como no envio', async () => {
    // "grande" tem 2.503 (as 3 sem telefone inclusas) e conta 2.500 acima;
    // uma etiqueta só delas conta zero — o envio as tira antes de virar linha.
    const aud: AudienceConfig = { type: 'tags', tagIds: ['instagram'] };
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(0);
  });

  it('a exclusão por etiqueta é aplicada, e paginada (1.200 > 1.000)', async () => {
    const aud: AudienceConfig = { type: 'tags', tagIds: ['grande'], excludeTagIds: ['excluir'] };
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(1300);
  });

  it('"todos os contatos" menos a exclusão', async () => {
    const aud: AudienceConfig = { type: 'all', excludeTagIds: ['excluir'] };
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(1300);
  });

  it('público por campo personalizado conta (o passo 4 dizia 0)', async () => {
    const aud: AudienceConfig = {
      type: 'custom_field',
      customField: { fieldId: 'area', operator: 'is', value: 'Bancário' },
    };
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(1100);
  });

  it('campo personalizado com exclusão', async () => {
    const aud: AudienceConfig = {
      type: 'custom_field',
      customField: { fieldId: 'area', operator: 'is_not', value: 'Bancário' },
      excludeTagIds: ['excluir'],
    };
    // 400 "Trabalhista" (c-01100…c-01499); a exclusão cobre c-00000…c-01199,
    // então 100 delas saem.
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(300);
  });

  it('CSV é o tamanho da lista', async () => {
    const aud: AudienceConfig = {
      type: 'csv',
      csvContacts: [{ phone: '5581988745316' }, { phone: '5581988745317' }],
    };
    expect(await contarPublico(bancoFalso(base()), aud)).toBe(2);
  });

  it('leitura que falha LANÇA — a tela diz que não contou, nunca afirma um número menor', async () => {
    const aud: AudienceConfig = { type: 'tags', tagIds: ['grande'], excludeTagIds: ['excluir'] };
    await expect(contarPublico(bancoFalso(base(), 'contacts'), aud)).rejects.toThrow();
  });
});

describe('o envio e a contagem usam a MESMA base e os MESMOS recortes (pino)', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'use-broadcast-sending.ts'), 'utf8');
  /** Do início da função de MÓDULO até o `}` que a fecha na coluna 0. */
  const corpo = (nome: string) => {
    const i = fonte.indexOf(nome);
    expect(i, `${nome} não encontrado`).toBeGreaterThan(-1);
    return fonte.slice(i, fonte.indexOf('\n}\n', i));
  };

  it('resolveAudience passa por contatosDaBase e aplicarRecortes', () => {
    const i = fonte.indexOf('async function resolveAudience(');
    const trecho = fonte.slice(i, fonte.indexOf('\n  }\n', i));
    expect(trecho).toContain('contatosDaBase(');
    expect(trecho).toContain('aplicarRecortes(');
  });

  it('contarPublico passa pelas mesmas duas', () => {
    const trecho = corpo('export async function contarPublico(');
    expect(trecho).toContain('contatosDaBase(');
    expect(trecho).toContain('aplicarRecortes(');
  });

  it('as telas não têm mais leitura própria de contact_tags/contact_custom_values', () => {
    const telas = [
      '../components/broadcasts/step2-select-audience.tsx',
      '../components/broadcasts/step4-schedule-send.tsx',
    ];
    for (const tela of telas) {
      const src = fs.readFileSync(path.join(__dirname, tela), 'utf8');
      expect(src, tela).toContain('contarPublico(');
      expect(src, tela).not.toMatch(/from\(\s*['"]contact_tags['"]\s*\)/);
      expect(src, tela).not.toMatch(/from\(\s*['"]contact_custom_values['"]\s*\)/);
    }
  });
});

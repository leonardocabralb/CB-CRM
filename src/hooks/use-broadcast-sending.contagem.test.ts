import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  contarPublico,
  motivoDaLeitura,
  type AudienceConfig,
} from './use-broadcast-sending';

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

interface Opcoes {
  /** A leitura desta tabela falha. */
  falhaEm?: string;
  /** Chamado depois de cada consulta servida — para mexer na tabela no meio. */
  depoisDe?: (tabela: string, tabelas: Record<string, Linha[]>) => void;
}

/**
 * Banco falso que APLICA os filtros e pagina como o PostgREST: `range`
 * devolve no máximo a fatia pedida, `limit` corta, e `count` é o total
 * filtrado. Sem aplicar os filtros, um mutante que tirasse o `.in()`
 * passaria verde (a lição do `storage.exists()`).
 */
function bancoFalso(tabelas: Record<string, Linha[]>, opcoes: Opcoes = {}) {
  return {
    from(tabela: string) {
      let linhas = [...(tabelas[tabela] ?? [])];
      let janela: [number, number] | null = null;
      let teto: number | null = null;
      let sinal: AbortSignal | null = null;
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
        gt(coluna: string, valor: string) {
          linhas = linhas.filter((l) => String(l[coluna]) > valor);
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
          janela = [de, ate];
          return consulta;
        },
        limit(n: number) {
          teto = n;
          return consulta;
        },
        abortSignal(s: AbortSignal) {
          sinal = s;
          return consulta;
        },
        then(ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) {
          const resposta = (() => {
            if (sinal?.aborted) {
              return { data: null, error: { message: 'AbortError: aborted' }, count: null };
            }
            if (opcoes.falhaEm === tabela) {
              return { data: null, error: { message: 'falhou' }, count: null };
            }
            const total = linhas.length;
            let data = linhas;
            if (janela) data = data.slice(janela[0], janela[1] + 1);
            if (teto !== null) data = data.slice(0, teto);
            return { data, error: null, count: total };
          })();
          opcoes.depoisDe?.(tabela, tabelas);
          return Promise.resolve(resposta).then(ok, falha);
        },
      };
      return consulta;
    },
  } as unknown as Parameters<typeof contarPublico>[0];
}

const id = (prefixo: string, n: number) => `${prefixo}-${String(n).padStart(5, '0')}`;
const CONTA = { accountId: 'conta-1' };

/** 2.500 fichas com telefone, 3 só do Instagram (telefone nulo), 2 com ''. */
function base() {
  const contacts: Linha[] = [];
  for (let n = 0; n < 2500; n++) contacts.push({ id: id('c', n), phone: `55819${n}` });
  for (let n = 0; n < 3; n++) contacts.push({ id: id('ig', n), phone: null });
  for (let n = 0; n < 2; n++) contacts.push({ id: id('vz', n), phone: '' });

  const contactTags: Linha[] = [];
  let tagRow = 0;
  // "grande": todas as fichas, inclusive as 5 sem telefone utilizável.
  for (const c of contacts) contactTags.push({ id: id('t', tagRow++), tag_id: 'grande', contact_id: c.id });
  // "instagram": só as sem telefone.
  for (let n = 0; n < 3; n++) {
    contactTags.push({ id: id('t', tagRow++), tag_id: 'instagram', contact_id: id('ig', n) });
  }
  for (let n = 0; n < 2; n++) {
    contactTags.push({ id: id('t', tagRow++), tag_id: 'instagram', contact_id: id('vz', n) });
  }
  // "excluir": 1.200 das 2.500 (mais que uma página).
  for (let n = 0; n < 1200; n++) {
    contactTags.push({ id: id('t', tagRow++), tag_id: 'excluir', contact_id: id('c', n) });
  }
  // "metade": 1.300 fichas que também estão em "excluir" ou não — sobrepõe.
  for (let n = 1000; n < 2300; n++) {
    contactTags.push({ id: id('t', tagRow++), tag_id: 'metade', contact_id: id('c', n) });
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
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(2500);
  });

  it('a ficha sem telefone utilizável (nulo ou vazio) fica de fora, como no envio', async () => {
    // "grande" tem 2.505 (as 5 sem telefone inclusas) e conta 2.500 acima;
    // uma etiqueta só delas conta zero — o envio as tira antes de virar linha.
    const aud: AudienceConfig = { type: 'tags', tagIds: ['instagram'] };
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(0);
  });

  it('quem tem as DUAS etiquetas conta uma vez', async () => {
    const aud: AudienceConfig = { type: 'tags', tagIds: ['excluir', 'metade'] };
    // excluir: c-0..1199; metade: c-1000..2299 → união c-0..2299.
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(2300);
  });

  it('a exclusão por etiqueta é aplicada, e paginada (1.200 > 1.000)', async () => {
    const aud: AudienceConfig = { type: 'tags', tagIds: ['grande'], excludeTagIds: ['excluir'] };
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(1300);
  });

  it('"todos os contatos" menos a exclusão', async () => {
    const aud: AudienceConfig = { type: 'all', excludeTagIds: ['excluir'] };
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(1300);
  });

  it('público por campo personalizado conta (o passo 4 dizia 0)', async () => {
    const aud: AudienceConfig = {
      type: 'custom_field',
      customField: { fieldId: 'area', operator: 'is', value: 'Bancário' },
    };
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(1100);
  });

  it('campo personalizado com exclusão', async () => {
    const aud: AudienceConfig = {
      type: 'custom_field',
      customField: { fieldId: 'area', operator: 'is_not', value: 'Bancário' },
      excludeTagIds: ['excluir'],
    };
    // 400 "Trabalhista" (c-01100…c-01499); a exclusão cobre c-00000…c-01199,
    // então 100 delas saem.
    expect(await contarPublico(bancoFalso(base()), aud, CONTA)).toBe(300);
  });

  it('leitura que falha LANÇA — a tela diz que não contou, nunca afirma um número menor', async () => {
    const aud: AudienceConfig = { type: 'tags', tagIds: ['grande'], excludeTagIds: ['excluir'] };
    await expect(contarPublico(bancoFalso(base(), { falhaEm: 'contacts' }), aud, CONTA)).rejects.toThrow();
  });

  it('a EXCLUSÃO que falha também lança — nunca vira "ninguém a poupar"', async () => {
    const aud: AudienceConfig = { type: 'all', excludeTagIds: ['excluir'] };
    await expect(
      contarPublico(bancoFalso(base(), { falhaEm: 'contact_tags' }), aud, CONTA),
    ).rejects.toThrow();
  });

  it('acima do teto de páginas lança com o motivo "teto", que a tela distingue', async () => {
    // 25.001 vínculos: as 25 páginas vêm cheias e ainda sobra um.
    const enorme: Linha[] = [];
    for (let n = 0; n < 25_001; n++) {
      enorme.push({ id: id('e', n).padEnd(8, '0'), tag_id: 'enorme', contact_id: id('c', n) });
    }
    const aud: AudienceConfig = { type: 'tags', tagIds: ['enorme'] };
    const erro = await contarPublico(bancoFalso({ contact_tags: enorme }), aud, CONTA).catch(
      (e: unknown) => e,
    );
    expect(erro).toBeInstanceOf(Error);
    expect(motivoDaLeitura(erro)).toBe('teto');
    // Um erro qualquer não é "teto".
    expect(motivoDaLeitura(new Error('x'))).toBeNull();
  });

  it('a contagem velha PARA: com o sinal abortado, nada é lido e a promessa rejeita', async () => {
    const controle = new AbortController();
    controle.abort();
    let consultas = 0;
    const banco = bancoFalso(base(), { depoisDe: () => consultas++ });
    const aud: AudienceConfig = { type: 'tags', tagIds: ['grande'] };
    await expect(contarPublico(banco, aud, { ...CONTA, sinal: controle.signal })).rejects.toThrow();
    expect(consultas).toBe(0);
  });
});

describe('"todos os contatos" é lido POR CHAVE: ficha nova no meio não repete ninguém', () => {
  it('uma ficha criada entre duas páginas não duplica a última da página anterior', async () => {
    // Por OFFSET, a ficha nova com id MENOR que o trecho já lido empurrava a
    // última linha da página 1 para a página 2: ela vinha duas vezes, e o
    // envio mandava o modelo pago em dobro a esse cliente.
    const tabelas = base();
    let inseriu = false;
    const banco = bancoFalso(tabelas, {
      depoisDe: (tabela, t) => {
        if (tabela !== 'contacts' || inseriu) return;
        inseriu = true;
        t.contacts.push({ id: 'a-00000', phone: '5581000000000' });
      },
    });
    const total = await contarPublico(banco, { type: 'all' }, CONTA);
    expect(total).toBe(2500);
  });
});

describe('CSV: a contagem aplica a exclusão às fichas que já existem, sem gravar nada', () => {
  const csv = [
    { phone: '5583980000016' },
    { phone: '5583980000017' },
    { phone: '5583980000018' },
    // a mesma pessoa, na outra grafia do nono dígito: conta uma vez
    { phone: '558380000018' },
    { phone: '5583980000019' },
  ];
  const tabelas = () => ({
    contacts: [
      // já existe COM etiqueta excluída — gravada na grafia sem o 9
      { id: 'x1', account_id: 'conta-1', phone: '558380000016', phone_normalized: '558380000016' },
      // já existe SEM etiqueta
      { id: 'x2', account_id: 'conta-1', phone: '5583980000017', phone_normalized: '5583980000017' },
      { id: 'x4', account_id: 'conta-1', phone: '5583980000019', phone_normalized: '5583980000019' },
      // de OUTRA conta, com a etiqueta: não conta
      { id: 'x3', account_id: 'conta-2', phone: '5583980000018', phone_normalized: '5583980000018' },
    ],
    contact_tags: [
      { id: 't1', tag_id: 'nao-enviar', contact_id: 'x1' },
      { id: 't2', tag_id: 'nao-enviar', contact_id: 'x3' },
    ],
  });

  it('sem exclusão é o número de pessoas do arquivo', async () => {
    const aud: AudienceConfig = { type: 'csv', csvContacts: csv };
    expect(await contarPublico(bancoFalso(tabelas()), aud, CONTA)).toBe(4);
  });

  it('com exclusão, sai quem já tem ficha com a etiqueta — nas duas grafias', async () => {
    const aud: AudienceConfig = { type: 'csv', csvContacts: csv, excludeTagIds: ['nao-enviar'] };
    // 4 pessoas; a ...016 já existe (sem o 9) com "nao-enviar", e só ela
    // sai. Duas já existem SEM a etiqueta (a assimetria pega o filtro
    // invertido). A ficha de outra conta não é lida (o `.eq('account_id')`).
    expect(await contarPublico(bancoFalso(tabelas()), aud, CONTA)).toBe(3);
  });

  it('sem a conta resolvida, com exclusão, não afirma número', async () => {
    const aud: AudienceConfig = { type: 'csv', csvContacts: csv, excludeTagIds: ['nao-enviar'] };
    await expect(contarPublico(bancoFalso(tabelas()), aud, { accountId: null })).rejects.toThrow();
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

  it('resolveAudience passa por contatosDaBase (com TODAS as colunas) e aplicarRecortes', () => {
    const i = fonte.indexOf('async function resolveAudience(');
    const trecho = fonte.slice(i, fonte.indexOf('\n  }\n', i));
    // '*' e não 'id, phone': o envio precisa de nome, e-mail e empresa para
    // as variáveis do modelo.
    expect(trecho).toContain("contatosDaBase(supabase, audience, '*')");
    expect(trecho).toContain('aplicarRecortes(');
  });

  it('contarPublico passa pelas mesmas duas, e o CSV pelas pessoas do envio', () => {
    const trecho = corpo('export async function contarPublico(');
    expect(trecho).toContain('contatosDaBase(');
    expect(trecho).toContain('aplicarRecortes(');
    expect(trecho).toContain('pessoasDoCsv(');
    expect(trecho).toContain('fichasDoCsvNaBase(');
  });

  it('o CSV do envio usa as MESMAS pessoas e a MESMA busca', () => {
    const i = fonte.indexOf('async function upsertCsvContacts(');
    const trecho = fonte.slice(i, fonte.indexOf('\n  async function ', i + 1));
    expect(trecho).toContain('pessoasDoCsv(csvRows)');
    expect(trecho).toContain('fichasDoCsvNaBase(');
  });

  it('as telas não têm mais leitura própria de contacts/contact_tags/contact_custom_values', () => {
    const telas = [
      '../components/broadcasts/step2-select-audience.tsx',
      '../components/broadcasts/step4-schedule-send.tsx',
    ];
    for (const tela of telas) {
      const src = fs.readFileSync(path.join(__dirname, tela), 'utf8');
      expect(src, tela).toContain('contarPublico(');
      // `contacts` inclusive: era a forma antiga do "todos" (count com head).
      expect(src, tela).not.toMatch(/from\(\s*['"]contacts['"]\s*\)/);
      expect(src, tela).not.toMatch(/from\(\s*['"]contact_tags['"]\s*\)/);
      expect(src, tela).not.toMatch(/from\(\s*['"]contact_custom_values['"]\s*\)/);
    }
  });
});

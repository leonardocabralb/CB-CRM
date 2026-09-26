import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  campoServeAoNo,
  campoServeAoRobo,
  destinoDaResposta,
  gravarRespostaNaFicha,
  nomeDigitadoNoChat,
  numeroDigitado,
  salvarEmDoDestino,
  tituloDaOpcao,
  valorParaOCampo,
} from './resposta-na-ficha';

// ============================================================
// O robô grava a resposta na FICHA (26/09/2026). As regras vêm de lugares
// que já valem no projeto — nome fixado (999), vazio não apaga, campo de
// data só com instante — e este arquivo pina cada uma.
// ============================================================

describe('destinoDaResposta', () => {
  it('lê nome e campo personalizado no "Coletar resposta"', () => {
    expect(destinoDaResposta('collect_input', 'name')).toEqual({ tipo: 'nome' });
    expect(destinoDaResposta('collect_input', 'custom:abc')).toEqual({
      tipo: 'campo',
      campoId: 'abc',
    });
  });

  it('botões e lista gravam só em CAMPO — o título de um botão não é nome', () => {
    expect(destinoDaResposta('send_buttons', 'name')).toBeNull();
    expect(destinoDaResposta('send_list', 'name')).toBeNull();
    expect(destinoDaResposta('send_buttons', 'custom:x')).toEqual({ tipo: 'campo', campoId: 'x' });
    expect(destinoDaResposta('send_list', 'custom:x')).toEqual({ tipo: 'campo', campoId: 'x' });
  });

  it('ausente, vazio, forma estranha ou nó que não grava = não grava nada', () => {
    expect(destinoDaResposta('collect_input', undefined)).toBeNull();
    expect(destinoDaResposta('collect_input', null)).toBeNull();
    expect(destinoDaResposta('collect_input', '')).toBeNull();
    expect(destinoDaResposta('collect_input', 'custom:')).toBeNull();
    expect(destinoDaResposta('collect_input', 'email')).toBeNull();
    expect(destinoDaResposta('collect_input', 42)).toBeNull();
    expect(destinoDaResposta('send_message', 'custom:x')).toBeNull();
  });

  it('a forma gravada volta igual', () => {
    expect(salvarEmDoDestino({ tipo: 'nome' })).toBe('name');
    expect(salvarEmDoDestino({ tipo: 'campo', campoId: 'x' })).toBe('custom:x');
  });
});

describe('tituloDaOpcao', () => {
  const botoes = {
    buttons: [
      { reply_id: 'sim', title: 'Fiquei encostado', next_node_key: 'a' },
      { reply_id: 'nao', title: 'Não recebi nada', next_node_key: 'b' },
    ],
  };
  const lista = {
    sections: [
      { rows: [{ reply_id: 'r1', title: 'Clavícula', next_node_key: 'a' }] },
      { rows: [{ reply_id: 'r2', title: 'Tornozelo', next_node_key: 'b' }] },
    ],
  };

  it('acha o título do botão e da linha tocados', () => {
    expect(tituloDaOpcao('send_buttons', botoes, 'nao')).toBe('Não recebi nada');
    expect(tituloDaOpcao('send_list', lista, 'r2')).toBe('Tornozelo');
  });

  it('reply_id que não é deste nó = null', () => {
    expect(tituloDaOpcao('send_buttons', botoes, 'talvez')).toBeNull();
    expect(tituloDaOpcao('send_list', lista, 'r9')).toBeNull();
    expect(tituloDaOpcao('collect_input', botoes, 'sim')).toBeNull();
    expect(tituloDaOpcao('send_buttons', {}, 'sim')).toBeNull();
  });
});

describe('valorParaOCampo', () => {
  it('texto e lista: aparado, e só isso', () => {
    expect(valorParaOCampo('text', '  Joana da Silva ')).toEqual({ ok: true, valor: 'Joana da Silva' });
    expect(valorParaOCampo('select', 'Fiquei encostado')).toEqual({
      ok: true,
      valor: 'Fiquei encostado',
    });
  });

  it('VAZIO NÃO APAGA o que a ficha já sabe', () => {
    expect(valorParaOCampo('text', '   ')).toEqual({ ok: false, motivo: 'empty value' });
  });

  it('campo de DATA só com instante de fuso escrito — o digitado pelo cliente não serve', () => {
    expect(valorParaOCampo('datetime', '12/03/2020').ok).toBe(false);
    expect(valorParaOCampo('datetime', '2026-08-30T19:00:00Z')).toEqual({
      ok: true,
      valor: '2026-08-30T19:00:00.000Z',
    });
  });

  it('campo NÚMERO só com número (vírgula vira ponto)', () => {
    expect(valorParaOCampo('number', ' 3 ')).toEqual({ ok: true, valor: '3' });
    expect(valorParaOCampo('number', '2,5')).toEqual({ ok: true, valor: '2.5' });
    expect(valorParaOCampo('number', 'uns três anos')).toEqual({ ok: false, motivo: 'not a number' });
  });

  it('a tela não oferece campo de data', () => {
    expect(campoServeAoRobo('text')).toBe(true);
    expect(campoServeAoRobo('select')).toBe(true);
    expect(campoServeAoRobo('number')).toBe(true);
    expect(campoServeAoRobo('datetime')).toBe(false);
  });

  it('o campo "E-mail" ESPELHADO só recebe o que tem forma de e-mail — ele vai para contacts.email', () => {
    expect(valorParaOCampo('text', 'não tenho', 'contacts.email')).toEqual({
      ok: false,
      motivo: 'not an e-mail',
    });
    expect(valorParaOCampo('text', ' ana@x.com ', 'contacts.email')).toEqual({
      ok: true,
      valor: 'ana@x.com',
    });
    // Campo de texto comum continua aceitando qualquer texto.
    expect(valorParaOCampo('text', 'não tenho', null)).toEqual({ ok: true, valor: 'não tenho' });
  });
});

describe('numeroDigitado', () => {
  it('"1.000" é MIL (ponto de milhar à brasileira), não um', () => {
    expect(numeroDigitado('1.000')).toBe('1000');
    expect(numeroDigitado('12.345.678')).toBe('12345678');
    expect(numeroDigitado('1.000,50')).toBe('1000.50');
    expect(numeroDigitado('-2.500')).toBe('-2500');
  });

  it('vírgula é decimal; ponto que não é milhar também', () => {
    expect(numeroDigitado('2,5')).toBe('2.5');
    expect(numeroDigitado('2.5')).toBe('2.5');
    expect(numeroDigitado('0.25')).toBe('0.25');
    expect(numeroDigitado(' 45 ')).toBe('45');
    expect(numeroDigitado('1000,5')).toBe('1000.5');
  });

  it('o que não é número = null', () => {
    expect(numeroDigitado('uns três')).toBeNull();
    expect(numeroDigitado('1.000.5')).toBeNull();
    expect(numeroDigitado('R$ 10')).toBeNull();
    expect(numeroDigitado('')).toBeNull();
  });
});

describe('campoServeAoNo', () => {
  const tipo = (field_type: string, espelho: string | null = null) => ({ field_type, espelho });

  it('botões e lista não gravam em NÚMERO nem no E-MAIL espelhado — o título "Sim" nunca seria um', () => {
    expect(campoServeAoNo('send_buttons', tipo('number'))).toBe(false);
    expect(campoServeAoNo('send_list', tipo('number'))).toBe(false);
    expect(campoServeAoNo('send_buttons', tipo('text', 'contacts.email'))).toBe(false);
    expect(campoServeAoNo('send_buttons', tipo('text'))).toBe(true);
    expect(campoServeAoNo('send_list', tipo('select'))).toBe(true);
  });

  it('"Coletar resposta" grava em texto, número, lista e e-mail; data nunca', () => {
    expect(campoServeAoNo('collect_input', tipo('text'))).toBe(true);
    expect(campoServeAoNo('collect_input', tipo('number'))).toBe(true);
    expect(campoServeAoNo('collect_input', tipo('select'))).toBe(true);
    expect(campoServeAoNo('collect_input', tipo('text', 'contacts.email'))).toBe(true);
    expect(campoServeAoNo('collect_input', tipo('datetime'))).toBe(false);
  });
});

describe('nomeDigitadoNoChat', () => {
  it('nome de gente passa como a pessoa escreveu (aparado)', () => {
    expect(nomeDigitadoNoChat('João da Silva')).toBe('João da Silva');
    expect(nomeDigitadoNoChat('maria')).toBe('maria');
    expect(nomeDigitadoNoChat("  Ana-Paula  D'Ávila. ")).toBe("Ana-Paula D'Ávila");
    expect(nomeDigitadoNoChat('José P. Souza')).toBe('José P. Souza');
  });

  it('saudação, resposta curta e o assunto do anúncio NÃO são nome', () => {
    for (const x of [
      'Bom dia',
      'bom dia!',
      'Oi',
      'Oi, tudo bem?',
      'Boa tarde tudo bem',
      'sim',
      'Não',
      'ok',
      'Obrigado',
      'Quero saber mais sobre auxílio acidente',
      'tenho interesse',
    ]) {
      expect(nomeDigitadoNoChat(x), x).toBeNull();
    }
  });

  it('emoji sai; emoji sozinho não é nada', () => {
    expect(nomeDigitadoNoChat('👍')).toBeNull();
    expect(nomeDigitadoNoChat('👍🏽')).toBeNull();
    expect(nomeDigitadoNoChat('Maria 😊')).toBe('Maria');
  });

  it('"Meu nome é …", "Me chamo …" e a saudação na frente saem', () => {
    expect(nomeDigitadoNoChat('Meu nome é Maria Souza')).toBe('Maria Souza');
    expect(nomeDigitadoNoChat('meu nome e: Carlos')).toBe('Carlos');
    expect(nomeDigitadoNoChat('Me chamo Ana.')).toBe('Ana');
    expect(nomeDigitadoNoChat('Bom dia, sou a Maria')).toBe('Maria');
    expect(nomeDigitadoNoChat('Eu sou o Pedro Henrique')).toBe('Pedro Henrique');
  });

  it('frase, número, várias linhas ou texto longo NÃO são nome', () => {
    expect(nomeDigitadoNoChat('Meu nome é João e sofri acidente em 2019')).toBeNull();
    expect(nomeDigitadoNoChat('(83) 98874-5316')).toBeNull();
    expect(nomeDigitadoNoChat('João\nSilva')).toBeNull();
    expect(nomeDigitadoNoChat('Maria, 45 anos')).toBeNull();
    expect(nomeDigitadoNoChat('Silva, Maria')).toBeNull();
    expect(nomeDigitadoNoChat('um dois três quatro cinco seis sete')).toBeNull();
    expect(nomeDigitadoNoChat('a'.repeat(61))).toBeNull();
    expect(nomeDigitadoNoChat('')).toBeNull();
    expect(nomeDigitadoNoChat(null)).toBeNull();
  });
});

// ------------------------------------------------------------
// I/O com um banco falso que REGISTRA o que foi pedido — as cercas de conta
// e o alvo do upsert são o que importa aqui.
// ------------------------------------------------------------

interface Chamada {
  tabela: string;
  op: string;
  valor?: unknown;
  filtros: Array<[string, unknown]>;
  opcoes?: unknown;
}

function bancoFalso(opts: {
  campo?: { id: string; field_type: string; espelho?: string | null } | null;
  erroCampo?: string;
  erroEscrita?: string;
  /** Linhas que o UPDATE do nome "mudou" — `[]` = já estava fixado. */
  linhasDoNome?: Array<{ id: string }>;
}) {
  const chamadas: Chamada[] = [];
  const db = {
    from(tabela: string) {
      const c: Chamada = { tabela, op: 'select', filtros: [] };
      chamadas.push(c);
      const b = {
        select: () => b,
        update: (v: unknown) => {
          c.op = 'update';
          c.valor = v;
          return b;
        },
        upsert: (v: unknown, o: unknown) => {
          c.op = 'upsert';
          c.valor = v;
          c.opcoes = o;
          return Promise.resolve({ error: opts.erroEscrita ? { message: opts.erroEscrita } : null });
        },
        eq: (col: string, v: unknown) => {
          c.filtros.push([col, v]);
          return b;
        },
        is: (col: string, v: unknown) => {
          c.filtros.push([`is:${col}`, v]);
          return b;
        },
        maybeSingle: () =>
          Promise.resolve(
            opts.erroCampo
              ? { data: null, error: { message: opts.erroCampo } }
              : { data: opts.campo ?? null, error: null },
          ),
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: opts.erroEscrita ? null : (opts.linhasDoNome ?? [{ id: 'ct' }]),
            error: opts.erroEscrita ? { message: opts.erroEscrita } : null,
          }),
      };
      return b;
    },
  };
  return { db: db as unknown as SupabaseClient, chamadas };
}

describe('gravarRespostaNaFicha', () => {
  it('NOME: grava fixado, cercado pela conta E só onde ninguém fixou o nome ainda', async () => {
    const { db, chamadas } = bancoFalso({});
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'nome' },
      valor: '  Joana   da Silva ',
    });
    expect(r.gravou).toBe(true);
    const upd = chamadas.find((c) => c.tabela === 'contacts' && c.op === 'update')!;
    expect(upd.valor).toMatchObject({ name: 'Joana da Silva' });
    expect((upd.valor as { nome_fixado_em?: unknown }).nome_fixado_em).toEqual(expect.any(String));
    // ⚠️ A condição mora no UPDATE: o nome que gente, o Asaas ou o Calendly
    // fixaram vence o texto livre do chat.
    expect(upd.filtros).toEqual([
      ['id', 'ct'],
      ['account_id', 'acc'],
      ['is:nome_fixado_em', null],
    ]);
  });

  it('NOME já fixado (zero linhas) NÃO é contado como gravado', async () => {
    const { db } = bancoFalso({ linhasDoNome: [] });
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'nome' },
      valor: 'Joana',
    });
    expect(r).toEqual({ gravou: false, detalhe: 'name not saved: the contact name was already fixed — kept' });
  });

  it('NOME: "Bom dia" não vira nome (e não chega ao banco)', async () => {
    const { db, chamadas } = bancoFalso({});
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'nome' },
      valor: 'Bom dia',
    });
    expect(r.gravou).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('NOME: resposta que não é nome (o telefone) NÃO sobrescreve', async () => {
    const { db, chamadas } = bancoFalso({});
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'nome' },
      valor: '(83) 98874-5316',
    });
    expect(r.gravou).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('CAMPO: confere que o campo é DA CONTA e faz upsert no único (contato, campo)', async () => {
    const { db, chamadas } = bancoFalso({ campo: { id: 'f1', field_type: 'text' } });
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'campo', campoId: 'f1' },
      valor: ' Fiquei encostado ',
    });
    expect(r.gravou).toBe(true);
    const leitura = chamadas.find((c) => c.tabela === 'custom_fields')!;
    expect(leitura.filtros).toEqual([
      ['id', 'f1'],
      ['account_id', 'acc'],
    ]);
    const up = chamadas.find((c) => c.tabela === 'contact_custom_values')!;
    expect(up.op).toBe('upsert');
    expect(up.valor).toEqual({ contact_id: 'ct', custom_field_id: 'f1', value: 'Fiquei encostado' });
    expect(up.opcoes).toEqual({ onConflict: 'contact_id,custom_field_id' });
  });

  it('CAMPO "E-mail" espelhado com texto que não é e-mail não é escrito', async () => {
    const { db, chamadas } = bancoFalso({
      campo: { id: 'f-email', field_type: 'text', espelho: 'contacts.email' },
    });
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'campo', campoId: 'f-email' },
      valor: 'não tenho',
    });
    expect(r).toEqual({ gravou: false, detalhe: 'field not saved: not an e-mail' });
    expect(chamadas.some((c) => c.tabela === 'contact_custom_values')).toBe(false);
  });

  it('CAMPO de outra conta (ou apagado) não é escrito', async () => {
    const { db, chamadas } = bancoFalso({ campo: null });
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'campo', campoId: 'f-de-outra-conta' },
      valor: 'x',
    });
    expect(r.gravou).toBe(false);
    expect(chamadas.some((c) => c.tabela === 'contact_custom_values')).toBe(false);
  });

  it('CAMPO de data com texto do cliente não é escrito', async () => {
    const { db, chamadas } = bancoFalso({ campo: { id: 'f1', field_type: 'datetime' } });
    const r = await gravarRespostaNaFicha(db, {
      accountId: 'acc',
      contactId: 'ct',
      destino: { tipo: 'campo', campoId: 'f1' },
      valor: 'ontem',
    });
    expect(r).toEqual({ gravou: false, detalhe: 'field not saved: not a date' });
    expect(chamadas.some((c) => c.tabela === 'contact_custom_values')).toBe(false);
  });

  it('erro de banco LANÇA (quem chama registra e segue o robô) — nunca vira "não encontrado"', async () => {
    const { db } = bancoFalso({ erroCampo: 'timeout' });
    await expect(
      gravarRespostaNaFicha(db, {
        accountId: 'acc',
        contactId: 'ct',
        destino: { tipo: 'campo', campoId: 'f1' },
        valor: 'x',
      }),
    ).rejects.toThrow(/timeout/);

    const escrita = bancoFalso({ campo: { id: 'f1', field_type: 'text' }, erroEscrita: 'boom' });
    await expect(
      gravarRespostaNaFicha(escrita.db, {
        accountId: 'acc',
        contactId: 'ct',
        destino: { tipo: 'campo', campoId: 'f1' },
        valor: 'x',
      }),
    ).rejects.toThrow(/boom/);
  });
});

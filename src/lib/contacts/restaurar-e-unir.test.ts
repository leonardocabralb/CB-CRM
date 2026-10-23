import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MOTIVOS_DO_RESTAURAR_E_UNIR,
  contatoDoItemDaMesmaPessoa,
  lerItensDaMesmaPessoa,
  lerPreviaDoRestaurarEUnir,
  lerRestaurarEUnir,
  motivoDoRestaurarEUnir,
  recusaDoErro,
} from './restaurar-e-unir';

// ============================================================
// "Restaurar e unir" (1101): a leitura do que as três funções devolvem. A
// forma CERTA copia o `jsonb_build_object`/`RETURNS TABLE` da migration; a
// TORTA é nula (a tela não afirma o que não leu); e a recusa volta como DADO,
// sem erro — a resposta sem forma nunca é "unida". Dados fictícios.
// ============================================================

const SQL = fs.readFileSync(
  path.join(__dirname, '../../../supabase/migrations/1101_cb_lixeira_restaurar_e_unir.sql'),
  'utf8',
);

const ITEM = '00000000-0000-4000-8000-0000000000a1';
const FICHA_QUE_VOLTA = '00000000-0000-4000-8000-0000000000c1';
const FICHA_QUE_FICA = '00000000-0000-4000-8000-0000000000c2';

/** A prévia da união como a 1093 devolve (o leitor dela é o de `uniao.ts`). */
const PREVIA_DA_UNIAO = {
  sugerida_fica: FICHA_QUE_FICA,
  motivo_da_sugestao: 'mensagem_do_cliente',
  bloqueios: [],
  nome_final: 'Fulana Teste',
  cards: [],
  divergencias: [],
  contatos_antigos: [],
  contagens: {
    mensagens: 12,
    anotacoes: 0,
    tarefas: 1,
    etiquetas_novas: 0,
    campos_preenchidos: 0,
    agendadas: 0,
    automacoes_interrompidas: 0,
    automacoes_que_seguem: 0,
    robos_parados: 0,
  },
};

describe('lerItensDaMesmaPessoa (a faixa)', () => {
  it('lê as colunas de cb_lixeira_da_mesma_pessoa', () => {
    const itens = lerItensDaMesmaPessoa([
      {
        id: ITEM,
        contact_id: FICHA_QUE_VOLTA,
        nome: 'Fulana Teste',
        telefone: '5500900000000',
        wa_username: null,
        instagram_username: null,
        movida_em: '2026-10-20T12:00:00+00:00',
        movida_por_nome: 'Admin Teste',
        vence_em: '2027-01-18T12:00:00+00:00',
        mensagens: 12,
        com_instagram: false,
      },
    ]);
    expect(itens).toEqual([
      {
        id: ITEM,
        contactId: FICHA_QUE_VOLTA,
        nome: 'Fulana Teste',
        telefone: '5500900000000',
        waUsername: null,
        instagramUsername: null,
        movidaEm: '2026-10-20T12:00:00+00:00',
        movidaPorNome: 'Admin Teste',
        mensagens: 12,
        comInstagram: false,
      },
    ]);
  });

  it('com Instagram (uma das duas fichas) só liga com true — a união recusaria', () => {
    const base = { id: ITEM, contact_id: FICHA_QUE_VOLTA, movida_em: '2026-10-20T12:00:00Z' };
    expect(lerItensDaMesmaPessoa([{ ...base, com_instagram: true }])![0].comInstagram).toBe(true);
    for (const v of [null, 'true', 1, undefined]) {
      expect(lerItensDaMesmaPessoa([{ ...base, com_instagram: v }])![0].comInstagram, String(v)).toBe(false);
    }
  });

  it('a resposta que não é lista é NULA (a faixa cala, nunca "nada na Lixeira")', () => {
    expect(lerItensDaMesmaPessoa(null)).toBeNull();
    expect(lerItensDaMesmaPessoa({ id: ITEM })).toBeNull();
    expect(lerItensDaMesmaPessoa('[]')).toBeNull();
  });

  it('a linha sem item, ficha ou data sai: não há botão sobre o que não se leu', () => {
    expect(
      lerItensDaMesmaPessoa([
        { contact_id: FICHA_QUE_VOLTA, movida_em: '2026-10-20T12:00:00Z' },
        { id: ITEM, movida_em: '2026-10-20T12:00:00Z' },
        { id: ITEM, contact_id: FICHA_QUE_VOLTA },
        'x',
      ]),
    ).toEqual([]);
  });

  it('mensagens ilegíveis ou negativas viram zero', () => {
    const [a] = lerItensDaMesmaPessoa([
      { id: ITEM, contact_id: FICHA_QUE_VOLTA, movida_em: '2026-10-20T12:00:00Z', mensagens: 'muitas' },
    ])!;
    expect(a.mensagens).toBe(0);
  });

  it('o item vira "contato" para as réguas de nome e identidade, sem BSUID', () => {
    const [a] = lerItensDaMesmaPessoa([
      {
        id: ITEM,
        contact_id: FICHA_QUE_VOLTA,
        movida_em: '2026-10-20T12:00:00Z',
        wa_username: 'fulana',
        wa_user_id: 'BR.nao-deve-aparecer',
      },
    ])!;
    expect(contatoDoItemDaMesmaPessoa(a)).toEqual({
      name: null,
      phone: null,
      wa_username: 'fulana',
      instagram_username: null,
    });
  });
});

describe('motivoDoRestaurarEUnir', () => {
  it('os códigos próprios da 1101', () => {
    expect(motivoDoRestaurarEUnir('item_sumiu', 'item_sumiu')).toBe('sumiu');
    expect(motivoDoRestaurarEUnir('identidade_nao_casa', 'identidade_nao_casa')).toBe('nao_casa');
    expect(motivoDoRestaurarEUnir('bloqueada:instagram', 'bloqueada:instagram')).toBe('bloqueada');
    expect(motivoDoRestaurarEUnir('bloqueada:bsuid_diferentes', 'bloqueada:bsuid_diferentes')).toBe('bloqueada');
    expect(motivoDoRestaurarEUnir('uniao_sem_tratamento:public.x', 'uniao_sem_tratamento:public.x')).toBe(
      'sem_tratamento',
    );
  });

  it('a porta, pelo erro do PostgREST (code = SQLSTATE, message = o texto do RAISE)', () => {
    expect(recusaDoErro({ code: '42501', message: 'so_admin' }).motivo).toBe('so_admin');
    expect(recusaDoErro({ code: '42501', message: 'membro_suspenso' }).motivo).toBe('membro_suspenso');
    expect(recusaDoErro({ code: 'P0001', message: 'ficha_nao_encontrada' }).motivo).toBe('ficha_nao_encontrada');
    // O anônimo nem chega à função.
    expect(recusaDoErro({ code: '42501', message: 'permission denied for function x' }).motivo).toBe('so_admin');
    expect(recusaDoErro(null).motivo).toBe('falhou');
  });

  it('os da Lixeira seguem a régua dela (motivoDoCodigo)', () => {
    expect(motivoDoRestaurarEUnir('identidade_ocupada', 'identidade_ocupada')).toBe('identidade_ocupada');
    expect(motivoDoRestaurarEUnir('em_processamento', 'em_processamento')).toBe('em_processamento');
    expect(motivoDoRestaurarEUnir('lixeira_schema_mudou:messages', 'lixeira_schema_mudou:messages')).toBe(
      'esquema_mudou',
    );
    expect(motivoDoRestaurarEUnir('55P03', 'canceling statement due to lock timeout')).toBe('ocupada');
    expect(motivoDoRestaurarEUnir('40P01', 'deadlock detected')).toBe('ocupada');
    expect(motivoDoRestaurarEUnir('23503', 'violates foreign key constraint')).toBe('presa');
    expect(motivoDoRestaurarEUnir('quem_sabe', 'quem_sabe')).toBe('falhou');
  });

  it('todo código que a 1101 levanta (RAISE) tem motivo próprio — os impossíveis caem em "falhou"', () => {
    const levantados = [...SQL.matchAll(/RAISE\s+EXCEPTION\s+'([a-z_]+)'/g)].map((m) => m[1]);
    expect(levantados).toEqual(expect.arrayContaining(['item_sumiu', 'identidade_nao_casa', 'em_processamento']));
    // Defesas que não acontecem com o banco coerente: a conta já foi filtrada,
    // a fotografia sempre tem a ficha, a reserva sempre sai.
    const impossiveis = new Set(['contas_diferentes', 'lixeira_ficha_nao_voltou', 'lixeira_reserva_sobrou']);
    for (const codigo of levantados) {
      if (impossiveis.has(codigo)) continue;
      expect(motivoDoRestaurarEUnir(codigo, codigo), codigo).not.toBe('falhou');
    }
  });

  it('a lista de motivos foi colhida do tipo (o teste dos textos depende dela)', () => {
    expect(MOTIVOS_DO_RESTAURAR_E_UNIR).toEqual(
      expect.arrayContaining(['sumiu', 'nao_casa', 'ficha_nao_encontrada', 'bloqueada', 'identidade_ocupada', 'falhou']),
    );
  });
});

describe('lerPreviaDoRestaurarEUnir', () => {
  const certa = {
    resultado: 'previa',
    item_id: ITEM,
    fica: { id: FICHA_QUE_FICA, name: 'Fulana Teste', phone: '+55 00 90000-0000', wa_username: null, instagram_username: null },
    sai: {
      id: FICHA_QUE_VOLTA,
      name: 'Fulana',
      phone: '5500900000000',
      wa_username: null,
      instagram_username: null,
      movida_em: '2026-10-20T12:00:00+00:00',
      movida_por_nome: 'Admin Teste',
    },
    previa: PREVIA_DA_UNIAO,
    relatorio: { tabelas: { contacts: { total: 1, inseridas: 1 } }, agendadas_em_falha: 2 },
  };

  it('a forma certa: as caixas, a prévia da união e as ressalvas da volta', () => {
    const r = lerPreviaDoRestaurarEUnir(certa);
    expect(r?.ok).toBe(true);
    if (!r || !r.ok) return;
    expect(r.previa.fica.id).toBe(FICHA_QUE_FICA);
    expect(r.previa.sai).toEqual({
      id: FICHA_QUE_VOLTA,
      name: 'Fulana',
      phone: '5500900000000',
      wa_username: null,
      instagram_username: null,
    });
    expect(r.previa.uniao.contagens.mensagens).toBe(12);
    expect(r.previa.ressalvas).toEqual([{ tipo: 'agendadas_em_falha', n: 2 }]);
  });

  it('a recusa volta como dado, com quem ocupa a identidade', () => {
    const r = lerPreviaDoRestaurarEUnir({
      resultado: 'recusada',
      item_id: ITEM,
      codigo: 'identidade_ocupada',
      motivo: 'identidade_ocupada',
      ocupada_por: FICHA_QUE_FICA,
      ocupada_por_nome: 'Outra Pessoa',
    });
    expect(r).toEqual({
      ok: false,
      recusa: { motivo: 'identidade_ocupada', ocupadaPor: FICHA_QUE_FICA, ocupadaPorNome: 'Outra Pessoa' },
    });
  });

  it('forma torta é NULA: sem prévia, sem botão', () => {
    expect(lerPreviaDoRestaurarEUnir(null)).toBeNull();
    expect(lerPreviaDoRestaurarEUnir([])).toBeNull();
    expect(lerPreviaDoRestaurarEUnir({ ...certa, resultado: 'unida' })).toBeNull();
    expect(lerPreviaDoRestaurarEUnir({ ...certa, fica: null })).toBeNull();
    expect(lerPreviaDoRestaurarEUnir({ ...certa, sai: { name: 'sem id' } })).toBeNull();
    // A régua da prévia da união: contagem que falta é forma inesperada.
    const contagens: Record<string, number> = { ...PREVIA_DA_UNIAO.contagens };
    delete contagens.mensagens;
    expect(lerPreviaDoRestaurarEUnir({ ...certa, previa: { ...PREVIA_DA_UNIAO, contagens } })).toBeNull();
  });
});

describe('lerRestaurarEUnir', () => {
  it('unida: a ficha que fica e a conversa (para recarregar nela)', () => {
    expect(
      lerRestaurarEUnir({
        resultado: 'unida',
        item_id: ITEM,
        contact_id: FICHA_QUE_VOLTA,
        ficha: FICHA_QUE_FICA,
        conversa: '00000000-0000-4000-8000-0000000000d1',
        fusao_id: '00000000-0000-4000-8000-0000000000f1',
        relatorio: {},
      }),
    ).toEqual({
      ok: true,
      resultado: {
        fusaoId: '00000000-0000-4000-8000-0000000000f1',
        ficha: FICHA_QUE_FICA,
        conversa: '00000000-0000-4000-8000-0000000000d1',
      },
    });
  });

  it('sem conversa (as duas fichas de formulário): conversa nula', () => {
    const r = lerRestaurarEUnir({
      resultado: 'unida',
      ficha: FICHA_QUE_FICA,
      conversa: null,
      fusao_id: '00000000-0000-4000-8000-0000000000f1',
    });
    expect(r?.ok && r.resultado.conversa).toBeNull();
  });

  it('a recusa (bloqueio da união) volta com o motivo', () => {
    expect(
      lerRestaurarEUnir({ resultado: 'recusada', item_id: ITEM, codigo: 'bloqueada:instagram', motivo: 'bloqueada:instagram' }),
    ).toEqual({ ok: false, recusa: { motivo: 'bloqueada', ocupadaPor: null, ocupadaPorNome: null } });
  });

  it('a resposta sem forma NÃO é "unida": a recusa também volta sem erro', () => {
    expect(lerRestaurarEUnir(null)).toBeNull();
    expect(lerRestaurarEUnir({ resultado: 'unida', ficha: FICHA_QUE_FICA })).toBeNull();
    expect(lerRestaurarEUnir({ resultado: 'restaurada' })).toBeNull();
  });
});

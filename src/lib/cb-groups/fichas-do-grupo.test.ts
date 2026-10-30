import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// O vínculo do grupo com as fichas de quem está nele (1117): o conjunto que
// a conferência manda à `cb_gravar_fichas_do_grupo` (a transação que apaga,
// grava e carimba é provada no SQL da 1117), nunca sobre uma leitura pela
// metade. Ids, telefones e nomes fictícios.
// ============================================================

import { criarBanco, type Banco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';
import type { ParticipanteDoGrupo } from '@/lib/cb-groups/sync';

import {
  VALIDADE_DA_CONFERENCIA_MS,
  chavesDasConexoes,
  conferenciaVencida,
  conferirFichasDoGrupo,
  conversasDasFichas,
  fichasParaGravar,
  gravarFichasDoGrupo,
} from './fichas-do-grupo';

const p = (over: Partial<ParticipanteDoGrupo>): ParticipanteDoGrupo => ({
  id: '111@lid',
  telefone: null,
  lid: '111@lid',
  papel: null,
  somosNos: false,
  ...over,
});

let b: Banco;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  b = criarBanco({
    contacts: [
      { id: 'ficha-ana', account_id: 'conta-1', name: 'Ana Teste', telefone_canonico: '5583980000016' },
      // A ficha de OUTRA conexão do escritório (a conversa interna).
      { id: 'ficha-escritorio', account_id: 'conta-1', name: 'Escritório', telefone_canonico: '5511987650002' },
    ],
    cb_channels: [
      { id: 'canal-a', account_id: 'conta-1', display_phone: '5583980000099' },
      // Gravado SEM o nono dígito: a chave de pessoa casa do mesmo jeito.
      { id: 'canal-b', account_id: 'conta-1', display_phone: '551187650002' },
      { id: 'canal-sem-numero', account_id: 'conta-1', display_phone: null },
    ],
    conversations: [
      { id: 'conv-ana', account_id: 'conta-1', contact_id: 'ficha-ana' },
      { id: 'conv-outra-conta', account_id: 'conta-2', contact_id: 'ficha-x' },
    ],
  });
  b.respostasDeRpc.cb_gravar_fichas_do_grupo = true;
});

const chamadas = () => b.rpcs.filter((r) => r.nome === 'cb_gravar_fichas_do_grupo').map((r) => r.args);

describe('fichasParaGravar', () => {
  const fichaDe = (x: ParticipanteDoGrupo) => (x.telefone ? `ficha-${x.telefone.slice(-2)}` : null);

  it('as fichas de quem está no grupo, sem o nosso número nem os do escritório', () => {
    expect(
      fichasParaGravar(
        [
          p({ telefone: '5583980000016' }),
          p({ telefone: '5583980000016' }),
          p({ telefone: '5583980000099', somosNos: true }),
          // Outro número do escritório, sem o nono dígito na lista.
          p({ telefone: '551187650002' }),
          p({ telefone: null }),
        ],
        fichaDe,
        new Set(['5511987650002']),
      ),
    ).toEqual(['ficha-16']);
  });

  it('⚠️ ninguém além de nós com telefone: NULO (só carimba, nunca "ninguém")', () => {
    expect(fichasParaGravar([p({ somosNos: true, telefone: '5583980000099' }), p({}), p({})], fichaDe, new Set())).toBeNull();
  });

  it('com telefones e nenhuma ficha: lista vazia (quem estava ligado sai)', () => {
    expect(fichasParaGravar([p({ telefone: '5583980000016' })], () => null, new Set())).toEqual([]);
  });
});

describe('gravarFichasDoGrupo', () => {
  it('manda o conjunto à função da 1117 e devolve se ela carimbou', async () => {
    expect(await gravarFichasDoGrupo(b.db, { accountId: 'conta-1', groupId: 'g-1', contatoIds: ['ficha-ana'] })).toBe(true);
    expect(chamadas()).toEqual([{ p_account_id: 'conta-1', p_group_id: 'g-1', p_contact_ids: ['ficha-ana'] }]);
  });

  it('grupo que não é da conta (a função devolve nulo) ou erro: falso', async () => {
    b.respostasDeRpc.cb_gravar_fichas_do_grupo = null;
    expect(await gravarFichasDoGrupo(b.db, { accountId: 'conta-1', groupId: 'g-1', contatoIds: [] })).toBe(false);
    b.falhasDeRpc.cb_gravar_fichas_do_grupo = { message: 'fora do ar' };
    expect(await gravarFichasDoGrupo(b.db, { accountId: 'conta-1', groupId: 'g-1', contatoIds: [] })).toBe(false);
  });
});

describe('conferirFichasDoGrupo', () => {
  const conferir = (participantes: ParticipanteDoGrupo[]) =>
    conferirFichasDoGrupo(b.db, { accountId: 'conta-1', groupId: 'g-1', participantes });

  it('acha as fichas pela chave de pessoa e deixa de fora as do escritório', async () => {
    const ok = await conferir([
      // Sem o nono dígito: a chave de pessoa casa com a ficha.
      p({ telefone: '558380000016' }),
      p({ telefone: '5511987650002' }),
      p({ telefone: '5583980000099', somosNos: true }),
    ]);
    expect(ok).toBe(true);
    expect(chamadas()).toEqual([{ p_account_id: 'conta-1', p_group_id: 'g-1', p_contact_ids: ['ficha-ana'] }]);
  });

  it('⚠️ fichas que não se leram, ou os números do escritório, não refazem nada', async () => {
    b.falhas.contacts = { message: 'fora do ar' };
    expect(await conferir([p({ telefone: '558380000016' })])).toBe(false);
    delete b.falhas.contacts;
    b.falhas.cb_channels = { message: 'fora do ar' };
    expect(await conferir([p({ telefone: '558380000016' })])).toBe(false);
    expect(chamadas()).toEqual([]);
  });

  it('⚠️ lista vazia é falha, nunca "ninguém no grupo"', async () => {
    expect(await conferir([])).toBe(false);
    expect(chamadas()).toEqual([]);
  });

  it('⚠️ lista sem telefone nenhum (a Evolution mudou o campo) só carimba', async () => {
    expect(await conferir([p({ telefone: '5583980000099', somosNos: true }), p({ id: '222@lid' })])).toBe(true);
    expect(chamadas()).toEqual([{ p_account_id: 'conta-1', p_group_id: 'g-1', p_contact_ids: null }]);
  });
});

describe('chavesDasConexoes', () => {
  it('a chave de pessoa de cada número da conta; falha = nulo', async () => {
    expect([...((await chavesDasConexoes(b.db, 'conta-1')) ?? [])].sort()).toEqual(['5511987650002', '5583980000099']);
    b.falhas.cb_channels = { message: 'fora do ar' };
    expect(await chavesDasConexoes(b.db, 'conta-1')).toBeNull();
  });
});

describe('conferenciaVencida', () => {
  const agora = Date.parse('2026-10-30T12:00:00.000Z');
  it('nunca conferida, ou há mais de 24 h, vence; dentro do prazo, não', () => {
    expect(conferenciaVencida(null, agora)).toBe(true);
    expect(conferenciaVencida(undefined, agora)).toBe(true);
    expect(conferenciaVencida('lixo', agora)).toBe(true);
    expect(conferenciaVencida(new Date(agora - VALIDADE_DA_CONFERENCIA_MS - 1).toISOString(), agora)).toBe(true);
    expect(conferenciaVencida(new Date(agora - VALIDADE_DA_CONFERENCIA_MS + 60_000).toISOString(), agora)).toBe(false);
  });
});

describe('conversasDasFichas', () => {
  it('a conversa de cada ficha, só desta conta; falha = mapa vazio', async () => {
    expect([...(await conversasDasFichas(b.db, 'conta-1', ['ficha-ana', 'ficha-x']))]).toEqual([['ficha-ana', 'conv-ana']]);
    b.falhas.conversations = { message: 'fora do ar' };
    expect((await conversasDasFichas(b.db, 'conta-1', ['ficha-ana'])).size).toBe(0);
  });
});

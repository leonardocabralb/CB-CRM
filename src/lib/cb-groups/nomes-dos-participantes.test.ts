import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// O nome de quem está no grupo: a ficha do CRM pela chave de pessoa, senão o
// nome com que escreveu no grupo, senão nada. Nomes, ids e telefones
// fictícios.
// ============================================================

import { criarBanco, type Banco } from '@/lib/whatsapp/sem-telefone/banco.test-helper';
import type { ParticipanteDoGrupo } from '@/lib/cb-groups/sync';

import { nomearParticipantes, ordenarParticipantes, type ParticipanteComNome } from './nomes-dos-participantes';

const participante = (over: Partial<ParticipanteDoGrupo>): ParticipanteDoGrupo => ({
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
      // Gravada COM o nono dígito; o WhatsApp entrega SEM.
      { id: 'ficha-ana', account_id: 'conta-1', name: 'Ana Teste', telefone_canonico: '5583980000016' },
      { id: 'ficha-outra-conta', account_id: 'conta-2', name: 'Não é desta conta', telefone_canonico: '5511922223333' },
    ],
    messages: [
      { conversation_id: 'conv-g', group_sender_jid: '5511922223333@s.whatsapp.net', group_sender_name: 'Bruno antigo', created_at: '2026-10-01T10:00:00Z' },
      { conversation_id: 'conv-g', group_sender_jid: '5511922223333@s.whatsapp.net', group_sender_name: 'Bruno Teste', created_at: '2026-10-20T10:00:00Z' },
      { conversation_id: 'conv-g', group_sender_jid: '333@lid', group_sender_name: 'Carla pelo LID', created_at: '2026-10-21T10:00:00Z' },
      // Celular gravado COM o nono dígito.
      { conversation_id: 'conv-g', group_sender_jid: '5511987650001@s.whatsapp.net', group_sender_name: 'Dora Teste', created_at: '2026-10-22T10:00:00Z' },
      { conversation_id: 'conv-outro', group_sender_jid: '444@lid', group_sender_name: 'De outro grupo', created_at: '2026-10-21T10:00:00Z' },
    ],
  });
});

const nomear = (participantes: ParticipanteDoGrupo[]) =>
  nomearParticipantes(b.db, { accountId: 'conta-1', conversationId: 'conv-g', participantes });

describe('nomearParticipantes', () => {
  it('a FICHA vem primeiro, pela chave de pessoa (o nono dígito não separa)', async () => {
    const [p] = await nomear([participante({ telefone: '558380000016' })]);
    expect(p).toMatchObject({ nome: 'Ana Teste', fonteDoNome: 'ficha', contatoId: 'ficha-ana' });
  });

  it('sem ficha DESTA conta, vale o nome mais recente com que escreveu no grupo', async () => {
    const [p] = await nomear([participante({ id: '222@lid', lid: '222@lid', telefone: '5511922223333' })]);
    expect(p).toMatchObject({ nome: 'Bruno Teste', fonteDoNome: 'grupo', contatoId: null });
  });

  it('o nome do grupo casa pela chave de pessoa: o nono dígito não separa', async () => {
    // Remetente gravado com 13 dígitos; a lista traz o mesmo celular com 12.
    const [p] = await nomear([participante({ id: '555@lid', lid: '555@lid', telefone: '551187650001' })]);
    expect(p).toMatchObject({ nome: 'Dora Teste', fonteDoNome: 'grupo' });
  });

  it('acha o nome pelo LID quando a mensagem veio só com ele', async () => {
    const [p] = await nomear([participante({ id: '333@lid', lid: '333@lid' })]);
    expect(p).toMatchObject({ nome: 'Carla pelo LID', fonteDoNome: 'grupo' });
  });

  it('o nome de OUTRO grupo não vale aqui', async () => {
    const [p] = await nomear([participante({ id: '444@lid', lid: '444@lid' })]);
    expect(p).toMatchObject({ nome: null, fonteDoNome: null });
  });

  it('a linha deste número fica sem nome (a tela a chama de "este número")', async () => {
    const [p] = await nomear([participante({ telefone: '558380000016', somosNos: true })]);
    expect(p.nome).toBeNull();
  });

  it('leitura das fichas que falha não derruba a lista: vale o nome do grupo', async () => {
    b.falhas.contacts = { message: 'fora do ar' };
    const lista = await nomear([
      participante({ telefone: '558380000016' }),
      participante({ id: '222@lid', lid: '222@lid', telefone: '5511922223333' }),
    ]);
    expect(lista.map((p) => p.nome)).toEqual([null, 'Bruno Teste']);
  });
});

describe('ordenarParticipantes', () => {
  const com = (over: Partial<ParticipanteComNome>): ParticipanteComNome => ({
    ...participante({}),
    nome: null,
    fonteDoNome: null,
    contatoId: null,
    ...over,
  });

  it('este número, o criador, os admins, quem tem nome e por fim quem só tem telefone', () => {
    const ordem = ordenarParticipantes([
      com({ id: 'tel', telefone: '5511900000002' }),
      com({ id: 'zeca', nome: 'Zeca' }),
      com({ id: 'admin', nome: 'Admin', papel: 'admin' }),
      com({ id: 'nos', somosNos: true }),
      com({ id: 'ana', nome: 'Ána' }),
      com({ id: 'criador', papel: 'criador' }),
      com({ id: 'oculto', telefone: null }),
      com({ id: 'tel-1', telefone: '5511900000001' }),
    ]).map((p) => p.id);
    // "Número oculto" (sem telefone) por último, depois de quem só tem telefone.
    expect(ordem).toEqual(['nos', 'criador', 'admin', 'ana', 'zeca', 'tel-1', 'tel', 'oculto']);
  });
});

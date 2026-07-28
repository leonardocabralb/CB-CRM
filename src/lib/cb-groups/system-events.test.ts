import { describe, it, expect } from 'vitest';
import {
  descreverParticipantes,
  parseGroupsUpsert,
  parseParticipantsUpdate,
} from './system-events';

const GRUPO = '120363123456789012@g.us';
const A = '111@lid';
const B = '222@lid';
const C = '333@lid';

describe('parseParticipantsUpdate', () => {
  it('lê a forma que a Evolution entrega', () => {
    expect(parseParticipantsUpdate({ id: GRUPO, action: 'add', participants: [A, B] })).toEqual({
      groupJid: GRUPO,
      acao: 'add',
      jids: [A, B],
    });
  });

  it('recusa ação desconhecida em vez de inventar frase', () => {
    expect(
      parseParticipantsUpdate({ id: GRUPO, action: 'modify', participants: [A] }),
    ).toBeNull();
  });

  it('recusa payload sem participante — não há o que anunciar', () => {
    expect(parseParticipantsUpdate({ id: GRUPO, action: 'add', participants: [] })).toBeNull();
    expect(parseParticipantsUpdate({ id: GRUPO, action: 'add' })).toBeNull();
  });

  it('recusa lixo sem estourar', () => {
    expect(parseParticipantsUpdate(null)).toBeNull();
    expect(parseParticipantsUpdate('texto')).toBeNull();
    expect(parseParticipantsUpdate({ action: 'add', participants: [A] })).toBeNull();
  });

  it('descarta entradas que não são string na lista', () => {
    expect(
      parseParticipantsUpdate({ id: GRUPO, action: 'remove', participants: [A, null, 7, ''] }),
    ).toEqual({ groupJid: GRUPO, acao: 'remove', jids: [A] });
  });
});

describe('descreverParticipantes', () => {
  const nomes = new Map([
    [A, 'Ana'],
    [B, 'Bruno'],
  ]);

  it('nomeia uma pessoa conhecida', () => {
    expect(descreverParticipantes('add', [A], nomes)).toBe('Ana entrou no grupo');
  });

  it('junta dois nomes com "e", e concorda no plural', () => {
    expect(descreverParticipantes('add', [A, B], nomes)).toBe(
      'Ana e Bruno entraram no grupo',
    );
  });

  it('⚠️ nunca mostra o LID cru de quem não conhecemos', () => {
    // O payload traz só JIDs, e em produção eles vêm em @lid. "247212…@lid
    // entrou no grupo" não informa nada a ninguém; a contagem informa.
    expect(descreverParticipantes('add', [C], new Map())).toBe(
      'Um participante entrou no grupo',
    );
    expect(descreverParticipantes('add', [A, C], new Map())).toBe(
      '2 participantes entraram no grupo',
    );
  });

  it('mistura conhecidos com contagem dos demais', () => {
    expect(descreverParticipantes('add', [A, C], nomes)).toBe('Ana e mais 1 entraram no grupo');
  });

  it('cobre sair, promover e rebaixar', () => {
    expect(descreverParticipantes('remove', [A], nomes)).toBe('Ana saiu do grupo');
    expect(descreverParticipantes('leave', [A], nomes)).toBe('Ana saiu do grupo');
    expect(descreverParticipantes('promote', [A], nomes)).toBe('Ana agora é administrador');
    expect(descreverParticipantes('demote', [A, B], nomes)).toBe(
      'Ana e Bruno deixaram de ser administradores',
    );
  });

  it('lista vazia não vira aviso', () => {
    expect(descreverParticipantes('add', [], nomes)).toBeNull();
  });
});

describe('parseGroupsUpsert', () => {
  it('lê um lote e mantém só o que é grupo', () => {
    expect(
      parseGroupsUpsert([
        { id: GRUPO, subject: 'Clientes SP' },
        { id: '5511999998888@s.whatsapp.net', subject: 'não é grupo' },
      ]),
    ).toEqual([{ jid: GRUPO, subject: 'Clientes SP' }]);
  });

  it('aceita objeto solto, não só array', () => {
    expect(parseGroupsUpsert({ id: GRUPO, subject: 'X' })).toEqual([
      { jid: GRUPO, subject: 'X' },
    ]);
  });

  it('subject ausente vira null — o chamador ignora e não apaga o nome atual', () => {
    expect(parseGroupsUpsert({ id: GRUPO })).toEqual([{ jid: GRUPO, subject: null }]);
  });

  it('lixo vira lista vazia, nunca exceção', () => {
    expect(parseGroupsUpsert(null)).toEqual([]);
    expect(parseGroupsUpsert([null, 'x', 42])).toEqual([]);
  });
});

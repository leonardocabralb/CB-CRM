import { describe, expect, it } from 'vitest';

import { filtrarParticipantes, lerRespostaDosParticipantes, type ParticipanteNaTela } from './participantes-na-tela';

const p = (over: Partial<ParticipanteNaTela>): ParticipanteNaTela => ({
  id: '111@lid',
  nome: null,
  fonteDoNome: null,
  telefone: null,
  papel: null,
  somosNos: false,
  contatoId: null,
  ...over,
});

describe('lerRespostaDosParticipantes', () => {
  it('lê campo a campo e descarta o que não entende', () => {
    const r = lerRespostaDosParticipantes({
      participantes: [
        { id: '111@lid', nome: ' Ana ', telefone: '5583980000016', papel: 'admin', somosNos: true, fonteDoNome: 'ficha', contatoId: 'c-1' },
        { id: '222@lid', telefone: '123@lid', papel: 'dono', somosNos: 'true' },
        { nome: 'sem id' },
      ],
      podeRenomear: true,
      soAdminEdita: false,
      grupo: { id: 'g-1', participant_count: 2 },
    });
    expect(r?.participantes).toEqual([
      p({ nome: 'Ana', telefone: '5583980000016', papel: 'admin', somosNos: true, fonteDoNome: 'ficha', contatoId: 'c-1' }),
      p({ id: '222@lid' }),
    ]);
    expect(r).toMatchObject({ podeRenomear: true, soAdminEdita: false, grupo: { id: 'g-1' } });
  });

  it('⚠️ lista vazia ou forma estranha é FALHA, nunca "nenhum participante"', () => {
    expect(lerRespostaDosParticipantes({ participantes: [] })).toBeNull();
    expect(lerRespostaDosParticipantes({ participantes: [{}] })).toBeNull();
    expect(lerRespostaDosParticipantes({ error: 'x' })).toBeNull();
    expect(lerRespostaDosParticipantes(null)).toBeNull();
  });

  it('podeRenomear só com `true` de verdade', () => {
    expect(lerRespostaDosParticipantes({ participantes: [{ id: 'a' }], podeRenomear: 'true' })?.podeRenomear).toBe(false);
  });
});

describe('filtrarParticipantes', () => {
  const lista = [
    p({ id: 'a', nome: 'José Antônio', telefone: '5583980000016' }),
    p({ id: 'b', nome: 'Maria', telefone: '5511922223333' }),
    p({ id: 'c', telefone: null }),
  ];

  it('acha pelo nome sem acento e sem caixa', () => {
    expect(filtrarParticipantes(lista, 'jose antonio').map((x) => x.id)).toEqual(['a']);
  });

  it('acha pelo número com 3 dígitos ou mais, em qualquer formato', () => {
    expect(filtrarParticipantes(lista, '(11) 92222').map((x) => x.id)).toEqual(['b']);
    expect(filtrarParticipantes(lista, '55').map((x) => x.id)).toEqual([]);
  });

  it('termo vazio devolve todos', () => {
    expect(filtrarParticipantes(lista, '   ')).toHaveLength(3);
  });
});

// ============================================================
// Cartão de contato (1060). As formas dos vCards abaixo são as MEDIDAS nos
// cartões reais de setembro (nomes e números trocados por fictícios).
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  MAX_CONTATOS,
  contatosDaMeta,
  lerContatosGravados,
  lerVcard,
  numeroParaConversar,
  resumoDosContatos,
} from './cartao-de-contato';

/** Cartão de EMPRESA do WhatsApp Business: FN, ORG e X-WA-BIZ-NAME repetem o nome. */
const VCARD_EMPRESA = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:;Assessoria Exemplo;;;',
  'FN:Assessoria Exemplo',
  'X-WA-BIZ-NAME:Assessoria Exemplo',
  'X-WA-BIZ-DESCRIPTION:Cobrança e negociação, atendimento de 8h às 18h',
  'ORG:Assessoria Exemplo;',
  'TEL;type=CELL;type=VOICE;waid=5585900000013:+55 85 90000-0013',
  'END:VCARD',
].join('\n');

/** Cartão de PESSOA salvo na agenda: rótulo `item1.` e foto em base64. */
const VCARD_PESSOA = [
  'BEGIN:VCARD',
  'VERSION:3.0',
  'N:Silva;Maria;;Dra.;',
  'FN:Dra. Maria Silva',
  'item1.TEL;waid=5583900000021:+55 83 90000-0021',
  'item1.X-ABLabel:Celular',
  'PHOTO;BASE64:/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/',
  'END:VCARD',
].join('\r\n');

describe('lerVcard', () => {
  it('cartão de empresa: nome uma vez, sem empresa repetida, telefone com waid', () => {
    expect(lerVcard(VCARD_EMPRESA, 'Assessoria Exemplo')).toEqual({
      nome: 'Assessoria Exemplo',
      empresa: null,
      telefones: [{ numero: '+55 85 90000-0013', waid: '5585900000013' }],
    });
  });

  it('cartão de pessoa: grupo `item1.` no TEL, CRLF, e a foto ignorada', () => {
    expect(lerVcard(VCARD_PESSOA)).toEqual({
      nome: 'Dra. Maria Silva',
      empresa: null,
      telefones: [{ numero: '+55 83 90000-0021', waid: '5583900000021' }],
    });
  });

  it('sem FN, o nome sai do N (na ordem de leitura), depois do displayName', () => {
    const semFn = 'BEGIN:VCARD\nN:Souza;João;Carlos;;\nTEL:+55 11 90000-0001\nEND:VCARD';
    expect(lerVcard(semFn)?.nome).toBe('João Carlos Souza');
    const vazio = 'BEGIN:VCARD\nN:;;;;\nFN:\nTEL;waid=5511900000001:+55 11 90000-0001\nEND:VCARD';
    expect(lerVcard(vazio, 'Contato da agenda')?.nome).toBe('Contato da agenda');
  });

  it('empresa aparece quando diz algo além do nome', () => {
    const v = 'BEGIN:VCARD\nFN:Pedro Lima\nORG:Banco Fictício S.A.;Jurídico\nTEL:+55 21 90000-0003\nEND:VCARD';
    expect(lerVcard(v)).toMatchObject({ nome: 'Pedro Lima', empresa: 'Banco Fictício S.A.' });
  });

  it('desfaz escapes, junta linha dobrada e aceita `tel:` do vCard 4', () => {
    const v = [
      'BEGIN:VCARD',
      'FN:Silva\\, Costa & Associados',
      'ORG:Escritório\\; Filial',
      'TEL;VALUE=uri:tel:+55 31 90000-',
      ' 0004',
      'END:VCARD',
    ].join('\n');
    expect(lerVcard(v)).toEqual({
      nome: 'Silva, Costa & Associados',
      empresa: 'Escritório; Filial',
      telefones: [{ numero: '+55 31 90000-0004', waid: null }],
    });
  });

  it('dois TEL do mesmo número (mesmo waid) viram um só; números diferentes, dois', () => {
    const v = [
      'BEGIN:VCARD',
      'FN:Ana',
      'TEL;waid=5585900000005:+55 85 90000-0005',
      'item2.TEL;waid=5585900000005:+55 (85) 90000-0005',
      'TEL:+55 85 3000-0006',
      'END:VCARD',
    ].join('\n');
    expect(lerVcard(v)?.telefones).toEqual([
      { numero: '+55 85 90000-0005', waid: '5585900000005' },
      { numero: '+55 85 3000-0006', waid: null },
    ]);
  });

  it('TEL sem valor mas com waid usa o waid; waid lixo é ignorado', () => {
    const v = 'BEGIN:VCARD\nFN:X\nTEL;waid=5585900000007:\nTEL;waid=abc:+55 85 90000-0008\nEND:VCARD';
    expect(lerVcard(v)?.telefones).toEqual([
      { numero: '+5585900000007', waid: '5585900000007' },
      { numero: '+55 85 90000-0008', waid: null },
    ]);
  });

  it('sem nome nem telefone não é contato', () => {
    expect(lerVcard('BEGIN:VCARD\nVERSION:3.0\nEND:VCARD')).toBeNull();
    expect(lerVcard(null)).toBeNull();
    expect(lerVcard('', '  ')).toBeNull();
  });

  it('só o displayName, sem vCard, ainda dá o nome', () => {
    expect(lerVcard(null, 'Fulano')).toEqual({ nome: 'Fulano', empresa: null, telefones: [] });
  });
});

describe('contatosDaMeta', () => {
  it('lê nome, empresa e telefones com wa_id', () => {
    expect(
      contatosDaMeta([
        {
          name: { formatted_name: 'Maria Silva', first_name: 'Maria' },
          org: { company: 'Banco Fictício' },
          phones: [{ phone: '+55 83 90000-0021', wa_id: '5583900000021', type: 'CELL' }],
        },
      ]),
    ).toEqual([
      {
        nome: 'Maria Silva',
        empresa: 'Banco Fictício',
        telefones: [{ numero: '+55 83 90000-0021', waid: '5583900000021' }],
      },
    ]);
  });

  it('sem formatted_name junta nome e sobrenome; sem phone usa o wa_id', () => {
    expect(
      contatosDaMeta([{ name: { first_name: 'João', last_name: 'Souza' }, phones: [{ wa_id: '5511900000001' }] }]),
    ).toEqual([{ nome: 'João Souza', empresa: null, telefones: [{ numero: '+5511900000001', waid: '5511900000001' }] }]);
  });

  it('entrada estranha não derruba nada', () => {
    expect(contatosDaMeta(undefined)).toEqual([]);
    expect(contatosDaMeta('x')).toEqual([]);
    expect(contatosDaMeta([null, 1, { phones: 'x' }])).toEqual([]);
  });

  it('respeita o teto de contatos', () => {
    const muitos = Array.from({ length: MAX_CONTATOS + 5 }, (_, i) => ({ name: { formatted_name: `C${i}` } }));
    expect(contatosDaMeta(muitos)).toHaveLength(MAX_CONTATOS);
  });
});

describe('resumoDosContatos', () => {
  it('uma linha por contato, com os números', () => {
    expect(
      resumoDosContatos([
        { nome: 'Assessoria Exemplo', empresa: null, telefones: [{ numero: '+55 85 90000-0013', waid: '5585900000013' }] },
        {
          nome: 'Ana',
          empresa: null,
          telefones: [
            { numero: '+55 85 90000-0005', waid: null },
            { numero: '+55 85 3000-0006', waid: null },
          ],
        },
      ]),
    ).toBe('👤 Assessoria Exemplo · +55 85 90000-0013\n👤 Ana · +55 85 90000-0005, +55 85 3000-0006');
  });

  it('sem nome mostra o número; sem número mostra o nome; vazio é null', () => {
    expect(resumoDosContatos([{ nome: '', empresa: null, telefones: [{ numero: '+55 1', waid: null }] }])).toBe(
      '👤 +55 1',
    );
    expect(resumoDosContatos([{ nome: 'Só nome', empresa: null, telefones: [] }])).toBe('👤 Só nome');
    expect(resumoDosContatos([])).toBeNull();
  });
});

describe('lerContatosGravados', () => {
  it('devolve a forma gravada', () => {
    const gravado = [{ nome: 'A', empresa: 'E', telefones: [{ numero: '+55 1', waid: '5511900000001' }] }];
    expect(lerContatosGravados(gravado)).toEqual(gravado);
  });

  it('linha fora da forma não derruba a bolha nem desenha "undefined"', () => {
    expect(lerContatosGravados(null)).toEqual([]);
    expect(lerContatosGravados({ nome: 'x' })).toEqual([]);
    expect(
      lerContatosGravados([
        null,
        { nome: 7, telefones: [{ numero: 5 }, { numero: '+55 2', waid: 'lixo' }] },
        { empresa: '', telefones: 'x' },
      ]),
    ).toEqual([{ nome: '', empresa: null, telefones: [{ numero: '+55 2', waid: null }] }]);
  });
});

describe('numeroParaConversar', () => {
  it('só com waid — número sem WhatsApp não tem com quem conversar', () => {
    expect(numeroParaConversar({ numero: '+55 85 90000-0013', waid: '5585900000013' })).toBe('+5585900000013');
    expect(numeroParaConversar({ numero: '+55 85 3000-0006', waid: null })).toBeNull();
  });
});

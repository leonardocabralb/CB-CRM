import { describe, it, expect } from 'vitest';
import {
  camposDoDetalhe,
  lerParticipantes,
  parseChatsParaGrupos,
  parseGroupInfo,
  podeRenomearAoVivo,
} from './sync';

const GRUPO = '120363123456789012@g.us';

describe('parseChatsParaGrupos', () => {
  it('separa grupo de conversa 1:1', () => {
    expect(
      parseChatsParaGrupos([
        { remoteJid: GRUPO, pushName: 'Clientes SP', profilePicUrl: 'http://x/1.jpg' },
        { remoteJid: '5511999998888@s.whatsapp.net', pushName: 'Ana' },
      ]),
    ).toEqual([{ jid: GRUPO, nome: 'Clientes SP', fotoUrl: 'http://x/1.jpg' }]);
  });

  it('⚠️ aceita o nome em pushName, name OU subject', () => {
    // O campo muda de lugar entre versões da Evolution. Em produção é
    // `pushName`; um upgrade do servidor não pode fazer todo grupo virar
    // "sem nome" de uma vez.
    expect(parseChatsParaGrupos([{ remoteJid: GRUPO, name: 'Por name' }])[0].nome).toBe(
      'Por name',
    );
    expect(parseChatsParaGrupos([{ remoteJid: GRUPO, subject: 'Por subject' }])[0].nome).toBe(
      'Por subject',
    );
  });

  it('aceita o jid em `id` quando não há `remoteJid`', () => {
    expect(parseChatsParaGrupos([{ id: GRUPO }])[0].jid).toBe(GRUPO);
  });

  it('nome em branco conta como ausente, não como nome vazio', () => {
    expect(parseChatsParaGrupos([{ remoteJid: GRUPO, pushName: '   ' }])[0].nome).toBeNull();
  });

  it('lixo não estoura nem entra na lista', () => {
    expect(parseChatsParaGrupos([null, 'x', 42, {}, { remoteJid: 123 }])).toEqual([]);
  });
});

describe('parseGroupInfo', () => {
  // Forma real da Evolution 2.3.2: participante tem id (@lid), jid (telefone),
  // lid e admin.
  const NOSSO = '558380000016';
  const INFO = {
    id: GRUPO,
    subject: 'Clientes SP',
    desc: 'grupo do escritório',
    pictureUrl: 'http://x/g.jpg',
    owner: '5511111111111@s.whatsapp.net',
    size: 3,
    announce: false,
    participants: [
      { id: '111@lid', jid: '5516999998784@s.whatsapp.net', lid: '111@lid', admin: null },
      { id: '222@lid', jid: '558380000016@s.whatsapp.net', lid: '222@lid', admin: 'admin' },
      { id: '333@lid', jid: '5511222223333@s.whatsapp.net', lid: '333@lid', admin: null },
    ],
  };

  it('extrai os metadados', () => {
    const d = parseGroupInfo(INFO, NOSSO);
    expect(d).toMatchObject({
      subject: 'Clientes SP',
      description: 'grupo do escritório',
      pictureUrl: 'http://x/g.jpg',
      ownerJid: '5511111111111@s.whatsapp.net',
      participantCount: 3,
      isAnnounce: false,
    });
  });

  it('⚠️ acha o NOSSO lid cruzando participants[].jid com o nosso número', () => {
    // É a única forma de descobrir o próprio LID: `participants[].id` vem
    // sempre em @lid e só o `.jid` traz telefone. Sem isso, menção a nós
    // nunca acende (916).
    expect(parseGroupInfo(INFO, NOSSO).ourLid).toBe('222@lid');
  });

  it('reconhece que somos admin', () => {
    expect(parseGroupInfo(INFO, NOSSO).weAreAdmin).toBe(true);
  });

  it('não somos admin quando a nossa linha não tem o campo', () => {
    expect(parseGroupInfo(INFO, '5516999998784').weAreAdmin).toBe(false);
  });

  it('compara só os dígitos — formatação do telefone não pode atrapalhar', () => {
    expect(parseGroupInfo(INFO, '+55 83 8000-0016').ourLid).toBe('222@lid');
  });

  it('⚠️ Baileys 7: participante vem como Contact — `phoneNumber` no lugar de `jid`, e às vezes o LID só em `id`', () => {
    // Forma do tipo `Contact` da Baileys 7 (`id` preferido; `phoneNumber`
    // quando `id` é LID; `lid` quando `id` é telefone). `.jid` não existe
    // mais — lendo só ele, a nossa linha nunca é achada e `ourLid`/`weAreAdmin`
    // viram null em silêncio (docs/PLANO-baileys-7.md, ajuste 3).
    const INFO7 = {
      ...INFO,
      participants: [
        { id: '111@lid', phoneNumber: '5516999998784@s.whatsapp.net', admin: null },
        { id: '222@lid', phoneNumber: '558380000016@s.whatsapp.net', admin: 'admin' },
        { id: '5511222223333@s.whatsapp.net', lid: '333@lid', admin: null },
      ],
    };
    const d = parseGroupInfo(INFO7, NOSSO);
    expect(d.ourLid).toBe('222@lid');
    expect(d.weAreAdmin).toBe(true);
    // Quando o `id` preferido é o telefone, o LID vem em `.lid`.
    expect(parseGroupInfo(INFO7, '5511222223333').ourLid).toBe('333@lid');
  });

  it('sem o nosso número, não chuta quem somos', () => {
    const d = parseGroupInfo(INFO, null);
    expect(d.ourLid).toBeNull();
    expect(d.weAreAdmin).toBe(false);
  });

  it('nosso número que não está no grupo não vira admin nem lid', () => {
    const d = parseGroupInfo(INFO, '5599999999999');
    expect(d.ourLid).toBeNull();
    expect(d.weAreAdmin).toBe(false);
  });

  it('sem lista de participantes, "somos admin" é DESCONHECIDO, não false', () => {
    // false destravaria o botão de renomear e a chamada falharia na cara do
    // operador; null deixa a UI dizer "ainda não sei".
    expect(parseGroupInfo({ id: GRUPO, subject: 'X' }, NOSSO).weAreAdmin).toBeNull();
  });

  it('cai para a contagem da lista quando `size` não vem', () => {
    expect(parseGroupInfo({ ...INFO, size: undefined }, NOSSO).participantCount).toBe(3);
  });

  it('lixo devolve tudo nulo em vez de estourar', () => {
    expect(parseGroupInfo(null, NOSSO).subject).toBeNull();
    expect(parseGroupInfo('texto', NOSSO).participantCount).toBeNull();
  });
});

describe('parseGroupInfo — o que a Fase 2 dos participantes acrescentou', () => {
  const BASE = {
    id: GRUPO,
    subject: 'Grupo de teste',
    size: 2,
    participants: [
      { id: '111@lid', phoneNumber: '5583980000016@s.whatsapp.net', admin: 'admin' },
      { id: '222@lid', phoneNumber: '5511922223333@s.whatsapp.net', admin: null },
    ],
  };

  it('lê o `restrict` como "só admin edita os dados"', () => {
    expect(parseGroupInfo({ ...BASE, restrict: true }, null).soAdminEdita).toBe(true);
    expect(parseGroupInfo({ ...BASE, restrict: false }, null).soAdminEdita).toBe(false);
    expect(parseGroupInfo(BASE, null).soAdminEdita).toBeNull();
  });

  it('⚠️ acha a nossa linha mesmo com o nono dígito diferente dos dois lados', () => {
    // O canal gravado SEM o 9 e o WhatsApp entregando COM ele (ou o
    // contrário): pela grafia, o admin de verdade saía "não admin".
    const d = parseGroupInfo(BASE, '558380000016');
    expect(d.weAreAdmin).toBe(true);
    expect(d.ourLid).toBe('111@lid');
  });
});

describe('podeRenomearAoVivo', () => {
  it('admin renomeia; grupo aberto a todos também; o resto não', () => {
    expect(podeRenomearAoVivo({ weAreAdmin: true, soAdminEdita: true })).toBe(true);
    expect(podeRenomearAoVivo({ weAreAdmin: false, soAdminEdita: false })).toBe(true);
    expect(podeRenomearAoVivo({ weAreAdmin: false, soAdminEdita: true })).toBe(false);
  });

  it('não saber NÃO destrava', () => {
    expect(podeRenomearAoVivo({ weAreAdmin: null, soAdminEdita: null })).toBe(false);
    expect(podeRenomearAoVivo({ weAreAdmin: false, soAdminEdita: null })).toBe(false);
  });
});

describe('camposDoDetalhe', () => {
  it('nunca grava NULL por cima do nome, da foto, da descrição e do dono', () => {
    const vazio = parseGroupInfo({ id: GRUPO, size: 1, participants: [{ id: '1@lid' }] }, null);
    const campos = camposDoDetalhe(vazio, '2026-10-29T12:00:00.000Z');
    expect(campos).toEqual({
      participant_count: 1,
      is_announce: null,
      we_are_admin: false,
      synced_at: '2026-10-29T12:00:00.000Z',
    });
  });
});

describe('lerParticipantes', () => {
  it('lê as três formas, o papel e a nossa linha', () => {
    const lidos = lerParticipantes(
      {
        participants: [
          { id: '111@lid', jid: '5516999998784@s.whatsapp.net', lid: '111@lid', admin: 'superadmin' },
          { id: '222@lid', phoneNumber: '558380000016@s.whatsapp.net', admin: 'admin' },
          { id: '5511922223333@s.whatsapp.net', lid: '333@lid', admin: null },
        ],
      },
      '5583980000016',
    );
    expect(lidos).toEqual([
      { id: '111@lid', telefone: '5516999998784', lid: '111@lid', papel: 'criador', somosNos: false },
      { id: '222@lid', telefone: '558380000016', lid: '222@lid', papel: 'admin', somosNos: true },
      { id: '5511922223333@s.whatsapp.net', telefone: '5511922223333', lid: '333@lid', papel: null, somosNos: false },
    ]);
  });

  it('quem esconde o número fica sem telefone, nunca com o LID no lugar', () => {
    const [p] = lerParticipantes({ participants: [{ id: '444@lid', admin: null }] }, null);
    expect(p.telefone).toBeNull();
    expect(p.lid).toBe('444@lid');
  });

  it('item sem id e lixo são descartados sem estourar', () => {
    expect(lerParticipantes({ participants: [null, 'x', {}, { id: 5 }] }, null)).toEqual([]);
    expect(lerParticipantes(null, null)).toEqual([]);
    expect(lerParticipantes({ participants: 'x' }, null)).toEqual([]);
  });
});

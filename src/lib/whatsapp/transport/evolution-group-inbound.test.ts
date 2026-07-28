import { describe, it, expect } from 'vitest';
import {
  extractMentionedJids,
  isGroupJid,
  mediaBytesOf,
  normalizeGroupUpsert,
  remetenteDoGrupo,
} from './evolution-group-inbound';

// Formas tiradas da sondagem real da Evolution 2.3.2 em produção
// (2026-07-27), não inventadas: participante em @lid, fileLength em STRING,
// e contextInfo na RAIZ da mensagem.
const GRUPO = '120363123456789012@g.us';

const MSG_GRUPO = {
  key: {
    remoteJid: GRUPO,
    fromMe: false,
    id: 'ABC123',
    participant: '247212345678590@lid',
  },
  pushName: 'Fulano',
  message: { conversation: 'bom dia' },
  messageTimestamp: 1800000000,
};

describe('isGroupJid', () => {
  it('reconhece grupo e recusa o resto', () => {
    expect(isGroupJid(GRUPO)).toBe(true);
    expect(isGroupJid('5511999998888@s.whatsapp.net')).toBe(false);
    expect(isGroupJid('123@lid')).toBe(false);
    expect(isGroupJid(undefined)).toBe(false);
  });
});

describe('remetenteDoGrupo', () => {
  it('prefere o telefone quando a Baileys oferece', () => {
    expect(
      remetenteDoGrupo({
        participant: '247212345678590@lid',
        participantPn: '5516999998784@s.whatsapp.net',
      }),
    ).toBe('5516999998784@s.whatsapp.net');
  });

  it('aceita participantAlt como segunda opção', () => {
    expect(
      remetenteDoGrupo({
        participant: '247212345678590@lid',
        participantAlt: '5516999998784@s.whatsapp.net',
      }),
    ).toBe('5516999998784@s.whatsapp.net');
  });

  it('⚠️ NÃO descarta quando só existe @lid — a regra do 1:1 não vale aqui', () => {
    // No 1:1 um LID sem telefone é descartado para não criar contato falso e
    // partir a conversa em duas. Grupo não cria contato nenhum: o remetente é
    // desnormalizado em messages.group_sender_*. Descartar aqui perderia
    // mensagem de gente real — e em produção TODO participante chega em @lid,
    // então a regra do 1:1 esvaziaria o grupo inteiro.
    expect(remetenteDoGrupo({ participant: '247212345678590@lid' })).toBe(
      '247212345678590@lid',
    );
  });

  it('devolve null quando não há participante nenhum', () => {
    expect(remetenteDoGrupo({ remoteJid: GRUPO })).toBeNull();
    expect(remetenteDoGrupo(undefined)).toBeNull();
  });
});

describe('extractMentionedJids', () => {
  it('lê o contextInfo da RAIZ da mensagem', () => {
    // Foi onde a sondagem achou o caso real. Ler só o extendedTextMessage,
    // como a documentação sugere, faz o destaque nunca acender.
    expect(
      extractMentionedJids({
        ...MSG_GRUPO,
        contextInfo: { mentionedJid: ['269712345678768@lid'] },
      } as never),
    ).toEqual(['269712345678768@lid']);
  });

  it('lê o contextInfo dentro do extendedTextMessage', () => {
    expect(
      extractMentionedJids({
        key: MSG_GRUPO.key,
        message: {
          extendedTextMessage: {
            text: 'oi @fulano',
            contextInfo: { mentionedJid: ['111@lid', '222@lid'] },
          },
        },
      }),
    ).toEqual(['111@lid', '222@lid']);
  });

  it('devolve lista vazia sem menção', () => {
    expect(extractMentionedJids(MSG_GRUPO)).toEqual([]);
  });

  it('ignora entradas que não são string', () => {
    expect(
      extractMentionedJids({
        ...MSG_GRUPO,
        contextInfo: { mentionedJid: ['ok@lid', null, 42, ''] },
      } as never),
    ).toEqual(['ok@lid']);
  });
});

describe('mediaBytesOf', () => {
  it('⚠️ converte o fileLength, que vem como STRING', () => {
    // Comparar a string com o teto de 5 MB daria resultado errado sem erro
    // nenhum: '900000' > 5242880 é false, mas '9000000' > 5242880 também.
    expect(
      mediaBytesOf({
        key: MSG_GRUPO.key,
        message: { imageMessage: { fileLength: '204800' } },
      }),
    ).toBe(204800);
  });

  it('atravessa invólucro (ver uma vez, efêmera)', () => {
    expect(
      mediaBytesOf({
        key: MSG_GRUPO.key,
        message: { viewOnceMessageV2: { message: { imageMessage: { fileLength: '1024' } } } },
      }),
    ).toBe(1024);
  });

  it('devolve null sem anexo, ou com fileLength ausente/inválido', () => {
    expect(mediaBytesOf(MSG_GRUPO)).toBeNull();
    expect(
      mediaBytesOf({ key: MSG_GRUPO.key, message: { imageMessage: {} } }),
    ).toBeNull();
    expect(
      mediaBytesOf({ key: MSG_GRUPO.key, message: { imageMessage: { fileLength: 'xis' } } }),
    ).toBeNull();
  });
});

describe('normalizeGroupUpsert', () => {
  it('normaliza uma mensagem de grupo', () => {
    const r = normalizeGroupUpsert(MSG_GRUPO, 'acc', 'user', 'ch1');
    expect(r).toMatchObject({
      accountId: 'acc',
      configOwnerUserId: 'user',
      channelId: 'ch1',
      fromMe: false,
      groupJid: GRUPO,
      senderJid: '247212345678590@lid',
      senderName: 'Fulano',
      providerMessageId: 'ABC123',
      contentType: 'text',
      text: 'bom dia',
      mentionedJids: [],
      mediaBytes: null,
    });
  });

  it('recusa o que não é grupo — esse caminho é do normalizeUpsert', () => {
    expect(
      normalizeGroupUpsert(
        { key: { remoteJid: '5511999998888@s.whatsapp.net', id: 'X' } },
        'acc',
        'user',
      ),
    ).toBeNull();
  });

  it('recusa sem id (não dá para deduplicar nem casar ACK)', () => {
    expect(normalizeGroupUpsert({ key: { remoteJid: GRUPO } }, 'acc', 'user')).toBeNull();
  });

  it('recusa reação — é estado da bolha, não mensagem', () => {
    expect(
      normalizeGroupUpsert(
        {
          key: { remoteJid: GRUPO, id: 'R1', participant: '1@lid' },
          message: { reactionMessage: { key: { id: 'ABC123' }, text: '👍' } },
        },
        'acc',
        'user',
      ),
    ).toBeNull();
  });

  it('marca fromMe (mensagem do aparelho pareado dentro do grupo)', () => {
    const r = normalizeGroupUpsert(
      { ...MSG_GRUPO, key: { ...MSG_GRUPO.key, fromMe: true } },
      'acc',
      'user',
    );
    expect(r?.fromMe).toBe(true);
  });

  it('usa a legenda da mídia como texto e captura os bytes', () => {
    const r = normalizeGroupUpsert(
      {
        key: MSG_GRUPO.key,
        pushName: 'Fulano',
        message: { imageMessage: { caption: 'o comprovante', fileLength: '77000' } },
        messageTimestamp: 1800000000,
      },
      'acc',
      'user',
    );
    expect(r?.contentType).toBe('image');
    expect(r?.text).toBe('o comprovante');
    expect(r?.mediaBytes).toBe(77000);
  });

  it('sem pushName o nome fica nulo, não vira o JID', () => {
    // O 1:1 cai para o telefone porque ele é discável e reconhecível. Um LID
    // como "247212345678590" não diz nada a ninguém — melhor a UI resolver.
    const r = normalizeGroupUpsert({ ...MSG_GRUPO, pushName: undefined }, 'acc', 'user');
    expect(r?.senderName).toBeNull();
  });
});

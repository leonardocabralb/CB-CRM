// ============================================================
// Entrada da Evolution: o que vira mensagem e o que é descartado.
//
// Estes casos nasceram de um bug real em produção: o primeiro canal
// Evolution recebia texto normalmente e NADA de mídia. Cada `it` aqui trava
// um pedaço daquele diagnóstico — se algum voltar a falhar, o cliente está
// mandando anexo que não aparece no inbox.
// ============================================================

import { describe, expect, it } from 'vitest';

import {
  detectContentType,
  extractText,
  isNonChatJid,
  isReaction,
  normalizeUpsert,
  phoneFromJid,
  unwrapMessage,
  type EvolutionUpsert,
} from './evolution-inbound';

function item(message: Record<string, unknown>, over: Partial<EvolutionUpsert> = {}) {
  return {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'MSG1' },
    pushName: 'Fulano',
    message,
    messageTimestamp: 1785080000,
    ...over,
  } satisfies EvolutionUpsert;
}

// Payloads espelhados no formato Baileys/Evolution v2.
const IMAGEM = {
  imageMessage: { mimetype: 'image/jpeg', caption: 'olha o contrato', mediaKey: 'k' },
};
const AUDIO_PTT = {
  audioMessage: { mimetype: 'audio/ogg; codecs=opus', ptt: true, seconds: 7, mediaKey: 'k' },
};
const FIGURINHA = { stickerMessage: { mimetype: 'image/webp', mediaKey: 'k' } };
const VIDEO = { videoMessage: { mimetype: 'video/mp4', mediaKey: 'k' } };
const DOCUMENTO = {
  documentMessage: { mimetype: 'application/pdf', fileName: 'peticao.pdf', mediaKey: 'k' },
};
const REACAO = {
  reactionMessage: {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'ALVO' },
    text: '\u{1F44D}',
  },
};

describe('detectContentType', () => {
  it('reconhece cada tipo de mídia', () => {
    expect(detectContentType({ conversation: 'Oi' })).toBe('text');
    expect(detectContentType(IMAGEM)).toBe('image');
    expect(detectContentType(AUDIO_PTT)).toBe('audio');
    expect(detectContentType(VIDEO)).toBe('video');
    expect(detectContentType(DOCUMENTO)).toBe('document');
    expect(detectContentType({ locationMessage: { degreesLatitude: -23 } })).toBe('location');
  });

  it('figurinha entra como imagem (não há tipo próprio no schema)', () => {
    expect(detectContentType(FIGURINHA)).toBe('image');
  });

  it('mídia "ver uma vez" é reconhecida, não confundida com texto', () => {
    // Antes disto, `viewOnceMessageV2` era lido como texto vazio: o cliente
    // mandava a foto do documento e no inbox não aparecia nada.
    expect(detectContentType({ viewOnceMessageV2: { message: IMAGEM } })).toBe('image');
    expect(detectContentType({ viewOnceMessage: { message: AUDIO_PTT } })).toBe('audio');
  });

  it('mídia de conversa efêmera é reconhecida', () => {
    expect(detectContentType({ ephemeralMessage: { message: IMAGEM } })).toBe('image');
  });

  it('documento com legenda é reconhecido', () => {
    expect(detectContentType({ documentWithCaptionMessage: { message: DOCUMENTO } })).toBe(
      'document',
    );
  });

  it('invólucro aninhado (efêmera + ver uma vez) também desce', () => {
    expect(
      detectContentType({ ephemeralMessage: { message: { viewOnceMessageV2: { message: VIDEO } } } }),
    ).toBe('video');
  });
});

describe('unwrapMessage', () => {
  it('não entra em laço infinito com invólucro que aponta para si mesmo', () => {
    // O payload vem de fora; sem limite de profundidade isto prenderia o
    // webhook para sempre.
    const ciclico: Record<string, unknown> = {};
    ciclico.ephemeralMessage = { message: ciclico };
    expect(() => unwrapMessage(ciclico)).not.toThrow();
  });

  it('devolve a própria mensagem quando não há invólucro', () => {
    expect(unwrapMessage(IMAGEM)).toBe(IMAGEM);
  });

  it('invólucro sem `message` dentro não perde o que já se tinha', () => {
    const truncado = { ephemeralMessage: {} };
    expect(unwrapMessage(truncado)).toBe(truncado);
  });
});

describe('extractText', () => {
  it('pega conversation e extendedTextMessage', () => {
    expect(extractText({ conversation: 'Oi' })).toBe('Oi');
    expect(extractText({ extendedTextMessage: { text: 'Olá' } })).toBe('Olá');
  });

  it('usa a legenda da mídia como texto', () => {
    expect(extractText(IMAGEM)).toBe('olha o contrato');
  });

  it('acha a legenda dentro do invólucro "ver uma vez"', () => {
    expect(extractText({ viewOnceMessageV2: { message: IMAGEM } })).toBe('olha o contrato');
  });

  it('mídia sem legenda devolve null', () => {
    expect(extractText(AUDIO_PTT)).toBeNull();
  });
});

describe('isNonChatJid', () => {
  it('barra grupo, canal e status', () => {
    expect(isNonChatJid('12345@g.us')).toBe(true);
    expect(isNonChatJid('12345@newsletter')).toBe(true);
    expect(isNonChatJid('status@broadcast')).toBe(true);
  });

  it('deixa passar conversa normal', () => {
    expect(isNonChatJid('5511999998888@s.whatsapp.net')).toBe(false);
  });

  it('deixa passar @lid — barrar perderia mensagem de cliente real', () => {
    expect(isNonChatJid('123456789@lid')).toBe(false);
  });
});

describe('isReaction', () => {
  it('reconhece reação, inclusive embrulhada', () => {
    expect(isReaction(REACAO)).toBe(true);
    expect(isReaction({ ephemeralMessage: { message: REACAO } })).toBe(true);
  });

  it('mensagem comum não é reação', () => {
    expect(isReaction({ conversation: 'Oi' })).toBe(false);
    expect(isReaction(IMAGEM)).toBe(false);
  });
});

describe('normalizeUpsert', () => {
  it('mídia vira mensagem com o tipo certo e mediaUrl a preencher depois', () => {
    const out = normalizeUpsert(item(IMAGEM), 'conta', 'dono', 'canal');
    expect(out).not.toBeNull();
    expect(out!.contentType).toBe('image');
    expect(out!.text).toBe('olha o contrato');
    // O webhook resolve o anexo DEPOIS de gravar — aqui é sempre null.
    expect(out!.mediaUrl).toBeNull();
    expect(out!.channelId).toBe('canal');
    expect(out!.phone).toBe('5511999998888');
  });

  it('descarta reação: ela não é mensagem e não pode disparar IA/automação', () => {
    expect(normalizeUpsert(item(REACAO), 'conta', 'dono', 'canal')).toBeNull();
  });

  it('descarta grupo, canal e status', () => {
    for (const jid of ['12345@g.us', '12345@newsletter', 'status@broadcast']) {
      const it0 = item(IMAGEM, { key: { remoteJid: jid, fromMe: false, id: 'X' } });
      expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')).toBeNull();
    }
  });

  it('NÃO descarta fromMe — marca a origem e deixa o chamador decidir', () => {
    // `fromMe` engloba duas coisas: o eco do que o CRM enviou (descartar) e
    // o que o operador digitou no celular pareado (tem de aparecer). Só o
    // `message_id` distingue, e isso exige ir ao banco — então descartar
    // aqui apagava metade do histórico da conversa.
    const doAparelho = item(IMAGEM, {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'X' },
    });
    const out = normalizeUpsert(doAparelho, 'conta', 'dono', 'canal');
    expect(out).not.toBeNull();
    expect(out!.fromMe).toBe(true);
    expect(out!.contentType).toBe('image');
  });

  it('mensagem do cliente vem com fromMe falso', () => {
    const out = normalizeUpsert(item({ conversation: 'Oi' }), 'conta', 'dono', 'canal');
    expect(out!.fromMe).toBe(false);
  });

  it('o telefone continua sendo o do cliente mesmo em fromMe', () => {
    // O JID é sempre o do OUTRO lado da conversa, inclusive quando fomos
    // nós que escrevemos. Se isto virasse o número do escritório, a
    // mensagem do celular abriria uma conversa do escritório com ele mesmo.
    const doAparelho = item({ conversation: 'respondi pelo celular' }, {
      key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true, id: 'Y' },
    });
    expect(normalizeUpsert(doAparelho, 'conta', 'dono', 'canal')!.phone).toBe('5511999998888');
  });

  it('descarta item sem key/id', () => {
    expect(normalizeUpsert({ message: IMAGEM }, 'conta', 'dono', 'canal')).toBeNull();
  });

  it('figurinha e ver-uma-vez chegam como mídia, não como texto vazio', () => {
    expect(normalizeUpsert(item(FIGURINHA), 'c', 'd', null)!.contentType).toBe('image');
    expect(
      normalizeUpsert(item({ viewOnceMessageV2: { message: AUDIO_PTT } }), 'c', 'd', null)!
        .contentType,
    ).toBe('audio');
  });
});

describe('phoneFromJid', () => {
  it('reduz o JID a dígitos', () => {
    expect(phoneFromJid('5511999998888@s.whatsapp.net')).toBe('5511999998888');
  });

  it('descarta a parte do aparelho', () => {
    expect(phoneFromJid('5511999998888:12@s.whatsapp.net')).toBe('5511999998888');
  });
});

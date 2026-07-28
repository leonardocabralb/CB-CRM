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
  parseDeleteEvent,
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

// Este bloco existe por causa de um bug que CHEGOU A PRODUÇÃO: o eco das
// mensagens enviadas pelo celular vinha com `@lid` (identificador interno do
// WhatsApp, não telefone), o contato era procurado por telefone, não achava,
// e a conversa do cliente se partia em duas — uma com o que ele escreveu,
// outra com nome de número sem sentido contendo as respostas do advogado.
describe('@lid — endereçamento novo do WhatsApp', () => {
  const LID = '71176265142382@lid';
  const TEL = '558393124441@s.whatsapp.net';

  it('LID sozinho é DESCARTADO: melhor não gravar que inventar contato', () => {
    const it0 = item({ conversation: 'oi' }, { key: { remoteJid: LID, fromMe: true, id: 'X' } });
    expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')).toBeNull();
  });

  it('LID com o telefone ao lado usa o TELEFONE', () => {
    for (const campo of ['remoteJidAlt', 'senderPn', 'participantPn', 'participantAlt']) {
      const it0 = item(
        { conversation: 'respondi pelo celular' },
        { key: { remoteJid: LID, fromMe: true, id: 'X', [campo]: TEL } },
      );
      const out = normalizeUpsert(it0, 'conta', 'dono', 'canal');
      expect(out, `campo ${campo}`).not.toBeNull();
      // O telefone REAL, para cair na conversa que já existe.
      expect(out!.phone, `campo ${campo}`).toBe('558393124441');
      expect(out!.remoteJid, `campo ${campo}`).toBe(TEL);
    }
  });

  it('a contrapartida não pode ser outro LID', () => {
    const it0 = item(
      { conversation: 'oi' },
      { key: { remoteJid: LID, fromMe: true, id: 'X', remoteJidAlt: '999@lid' } },
    );
    expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')).toBeNull();
  });

  it('conversa normal segue intocada', () => {
    const it0 = item({ conversation: 'oi' }, { key: { remoteJid: TEL, fromMe: false, id: 'X' } });
    expect(normalizeUpsert(it0, 'conta', 'dono', 'canal')!.phone).toBe('558393124441');
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

// ============================================================
// `messages.delete` — as DUAS formas de payload.
//
// Bug real de produção (27/07/2026): o handler lia só o id de primeiro
// nível. Na exclusão vinda da API da Evolution esse campo é o id INTERNO do
// banco dela, então o UPDATE acertava zero linhas em silêncio — e era
// justamente a forma que fecharia o ciclo do nosso próprio botão de apagar.
// ============================================================
describe('parseDeleteEvent', () => {
  // Forma 1: exclusão feita no celular / em outro cliente do WhatsApp.
  it('lê a chave achatada', () => {
    expect(parseDeleteEvent({ id: '3EB0AAA', remoteJid: '55@s.whatsapp.net', fromMe: false })).toEqual([
      { providerMessageId: '3EB0AAA', fromMe: false },
    ]);
    expect(parseDeleteEvent({ keyId: '3EB0BBB', fromMe: true })).toEqual([
      { providerMessageId: '3EB0BBB', fromMe: true },
    ]);
  });

  // Forma 2 — a que estava sendo perdida. O `id` de fora é lixo para nós.
  it('prefere key.id ao id de primeiro nível, que é o UUID interno da Evolution', () => {
    expect(
      parseDeleteEvent({
        id: '0c2a1f5e-8b3d-4a11-9f6c-2b7e5d9a1c34',
        key: { id: '3EB0CCC', fromMe: true, remoteJid: '55@s.whatsapp.net' },
      }),
    ).toEqual([{ providerMessageId: '3EB0CCC', fromMe: true }]);
  });

  it('aceita lote em array', () => {
    expect(
      parseDeleteEvent([{ keyId: 'A', fromMe: true }, { key: { id: 'B' } }]),
    ).toEqual([
      { providerMessageId: 'A', fromMe: true },
      { providerMessageId: 'B', fromMe: false },
    ]);
  });

  // `fromMe` decide QUEM apagou, e o rótulo na bolha sai daí. Ausente tem de
  // significar "o contato", nunca "nós" — atribuir a nós uma exclusão do
  // cliente reescreve o histórico do atendimento.
  it('fromMe ausente ou não-booleano vira false', () => {
    expect(parseDeleteEvent({ keyId: 'A' })[0].fromMe).toBe(false);
    expect(parseDeleteEvent({ keyId: 'A', fromMe: 'true' })[0].fromMe).toBe(false);
    expect(parseDeleteEvent({ key: { id: 'A', fromMe: null } })[0].fromMe).toBe(false);
  });

  // Nada aqui pode lançar: é um webhook, e uma exceção vira 500 que faz a
  // Evolution reentregar o lote inteiro para sempre.
  it('payload sem id utilizável devolve lista vazia, nunca exceção', () => {
    for (const lixo of [null, undefined, {}, [], 42, 'texto', { id: 7 }, { key: {} }, [null, {}]]) {
      expect(parseDeleteEvent(lixo), JSON.stringify(lixo)).toEqual([]);
    }
  });
});

// ============================================================
// `previousRemoteJid` — o endereço para AGIR sobre a mensagem.
//
// Bug real de produção (28/07/2026): depois que a Evolution passou a
// reescrever `@lid` → telefone (patch da baileys), apagar pelo CRM uma
// mensagem enviada pelo CELULAR deixou de fazer efeito. A revogação ia para a
// conversa "telefone" e a mensagem vive na "@lid". O endereço original chega
// em `key.previousRemoteJid` e estava sendo descartado. Ver migration 917.
// ============================================================
describe('normalizeUpsert — endereço @lid da conversa', () => {
  const TEXTO = { conversation: 'oi' };

  it('guarda o @lid quando a Evolution reescreveu o endereço', () => {
    const out = normalizeUpsert(
      item(TEXTO, {
        key: {
          remoteJid: '5511964102992@s.whatsapp.net',
          previousRemoteJid: '192603597332721@lid',
          fromMe: true,
          id: '3A65CF57',
        },
      }),
      'conta',
      'dono',
      'canal',
    );
    // O telefone continua sendo quem IDENTIFICA a conversa...
    expect(out!.remoteJid).toBe('5511964102992@s.whatsapp.net');
    expect(out!.phone).toBe('5511964102992');
    // ...e o @lid é quem permite AGIR sobre a mensagem.
    expect(out!.remoteJidLid).toBe('192603597332721@lid');
  });

  it('conversa não migrada não tem @lid — e null aqui é o caso normal', () => {
    const out = normalizeUpsert(item(TEXTO), 'conta', 'dono', 'canal');
    expect(out!.remoteJidLid).toBeNull();
  });

  // A guarda importa: se o campo vier com um telefone (ou lixo), gravá-lo
  // faria a revogação sair para um endereço inventado. Só LID entra.
  it('ignora previousRemoteJid que NÃO seja um @lid', () => {
    for (const bruto of [
      '5511964102992@s.whatsapp.net',
      '120363000000000000@g.us',
      '',
      'lixo',
    ]) {
      const out = normalizeUpsert(
        item(TEXTO, {
          key: {
            remoteJid: '5511964102992@s.whatsapp.net',
            previousRemoteJid: bruto,
            fromMe: true,
            id: 'X',
          },
        }),
        'conta',
        'dono',
        'canal',
      );
      expect(out!.remoteJidLid, bruto).toBeNull();
    }
  });
});

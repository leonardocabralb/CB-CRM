import { describe, expect, it } from 'vitest';

import { clienteDe, interpretarWebhook, midiaDoAnexo } from './webhook';

// Formas MEDIDAS na Fase 0 (09/09/2026): entry.id de 17 dígitos (a conta),
// sender.id de 16 dígitos (o cliente), mid base64 longo.
const CONTA = '17841457826920658';
const CLIENTE = '1663055967608091';
const MID =
  'aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE3ODQxNDU3ODI2OTIwNjU4OjM0MDI4MjM2Njg0MTcxMDMwMTI0NDI3NjM3ODc2NTg1MzM3NDIyMDozMjIxNzI2NDEwNDkzNjA1MjM2NTg3MTk2MDAxNDYwNDI4OAZDZD';

function corpo(messaging: unknown[]) {
  return {
    object: 'instagram',
    entry: [{ id: CONTA, time: 1757460907000, messaging }],
  };
}

describe('interpretarWebhook', () => {
  it('texto: remetente, destinatário, mid, texto', () => {
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1757460907123,
          message: { mid: MID, text: 'Oi' },
        },
      ])
    );
    expect(r.ehInstagram).toBe(true);
    expect(r.eventos).toEqual([
      {
        tipo: 'mensagem',
        igUserId: CONTA,
        remetente: CLIENTE,
        destinatario: CONTA,
        timestampMs: 1757460907123,
        mid: MID,
        texto: 'Oi',
        anexos: [],
        ehEco: false,
        apagada: false,
        naoSuportada: false,
        respostaA: null,
        quickReply: null,
      },
    ]);
  });

  it('nota de voz: attachments[type=audio] com URL assinada, sem mime', () => {
    const url =
      'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1&signature=abc';
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message: {
            mid: MID,
            attachments: [{ type: 'audio', payload: { url } }],
          },
        },
      ])
    );
    const ev = r.eventos[0];
    expect(ev.tipo).toBe('mensagem');
    if (ev.tipo !== 'mensagem') throw new Error();
    expect(ev.texto).toBeNull();
    expect(ev.anexos).toEqual([{ tipo: 'audio', url, tipoCru: 'audio' }]);
    // A classe vem do `type` do webhook — o CDN diria video/mp4.
    expect(midiaDoAnexo(ev.anexos[0])).toEqual({
      classe: 'audio',
      mime: 'audio/mp4',
    });
  });

  it('o message_edit de num_edit 0 que acompanha toda DM é IGNORADO', () => {
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message_edit: { mid: MID, text: 'Oi', num_edit: 0 },
        },
      ])
    );
    expect(r.eventos).toEqual([
      expect.objectContaining({
        tipo: 'ignorado',
        motivo: 'message_edit com num_edit 0',
      }),
    ]);
  });

  it('edição de verdade (num_edit ≥ 1) vira `edicao`', () => {
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message_edit: { mid: MID, text: 'Oi, corrigido', num_edit: 1 },
        },
      ])
    );
    expect(r.eventos[0]).toMatchObject({
      tipo: 'edicao',
      mid: MID,
      texto: 'Oi, corrigido',
      numEdit: 1,
    });
  });

  it('eco: a mensagem é da conta, e o cliente é o DESTINATÁRIO', () => {
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CONTA },
          recipient: { id: CLIENTE },
          timestamp: 1,
          message: { mid: MID, text: 'Olá!', is_echo: true },
        },
      ])
    );
    const ev = r.eventos[0];
    if (ev.tipo !== 'mensagem') throw new Error();
    expect(ev.ehEco).toBe(true);
    expect(clienteDe(ev)).toBe(CLIENTE);
    // Sem eco, o cliente é quem manda.
    expect(clienteDe({ ...ev, ehEco: false })).toBe(CONTA);
  });

  it('apagada, não suportada, resposta a mensagem e a story, quick reply', () => {
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message: { mid: 'a', is_deleted: true },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message: { mid: 'b', is_unsupported: true },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message: { mid: 'c', text: 'x', reply_to: { mid: MID } },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message: {
            mid: 'd',
            text: 'y',
            reply_to: { story: { id: '9', url: 'https://cdn/x' } },
          },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          message: { mid: 'e', text: 'Sim', quick_reply: { payload: 'SIM' } },
        },
      ])
    );
    expect(r.eventos.map((e) => e.tipo)).toEqual([
      'mensagem',
      'mensagem',
      'mensagem',
      'mensagem',
      'mensagem',
    ]);
    expect(r.eventos[0]).toMatchObject({ apagada: true });
    expect(r.eventos[1]).toMatchObject({ naoSuportada: true });
    expect(r.eventos[2]).toMatchObject({ respostaA: { mid: MID } });
    expect(r.eventos[3]).toMatchObject({
      respostaA: { story: { id: '9', url: 'https://cdn/x' } },
    });
    expect(r.eventos[4]).toMatchObject({ quickReply: 'SIM' });
  });

  it('reação, postback, lida e referral', () => {
    const r = interpretarWebhook(
      corpo([
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          reaction: {
            mid: MID,
            action: 'react',
            reaction: 'love',
            emoji: '❤️',
          },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          reaction: { mid: MID, action: 'unreact' },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          postback: { mid: 'p', title: 'Falar com advogado', payload: 'ADV' },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          read: { mid: MID },
        },
        {
          sender: { id: CLIENTE },
          recipient: { id: CONTA },
          timestamp: 1,
          referral: { ref: 'promo', source: 'IGME', type: 'OPEN_THREAD' },
        },
      ])
    );
    expect(r.eventos[0]).toMatchObject({
      tipo: 'reacao',
      acao: 'react',
      reacao: 'love',
      emoji: '❤️',
    });
    expect(r.eventos[1]).toMatchObject({
      tipo: 'reacao',
      acao: 'unreact',
      emoji: null,
    });
    expect(r.eventos[2]).toMatchObject({
      tipo: 'postback',
      titulo: 'Falar com advogado',
      payload: 'ADV',
    });
    expect(r.eventos[3]).toMatchObject({ tipo: 'lida', mid: MID });
    expect(r.eventos[4]).toMatchObject({
      tipo: 'referral',
      ref: 'promo',
      source: 'IGME',
      kind: 'OPEN_THREAD',
    });
  });

  it('não lança em forma estranha: vira `ignorado` com o motivo, ou some', () => {
    // object errado → não é Instagram
    expect(
      interpretarWebhook({ object: 'whatsapp_business_account', entry: [] })
    ).toEqual({ ehInstagram: false, eventos: [] });
    expect(interpretarWebhook(null)).toEqual({
      ehInstagram: false,
      eventos: [],
    });
    expect(interpretarWebhook('texto')).toEqual({
      ehInstagram: false,
      eventos: [],
    });
    // entry sem id e messaging sem remetente somem; chaves desconhecidas viram ignorado
    const r = interpretarWebhook({
      object: 'instagram',
      entry: [
        { time: 1, messaging: [{ message: { mid: 'x' } }] },
        {
          id: CONTA,
          messaging: [
            {
              sender: { id: CLIENTE },
              recipient: { id: CONTA },
              coisa_nova: {},
            },
          ],
        },
        { id: CONTA, changes: [{ field: 'comments' }] },
      ],
    });
    expect(r.ehInstagram).toBe(true);
    expect(r.eventos).toEqual([
      expect.objectContaining({
        tipo: 'ignorado',
        motivo: expect.stringContaining('coisa_nova'),
      }),
    ]);
  });

  it('entry.id e sender.id numéricos viram string (a Meta às vezes manda número)', () => {
    const r = interpretarWebhook({
      object: 'instagram',
      entry: [
        {
          id: 17841457826920658,
          messaging: [
            {
              sender: { id: 1663055967608091 },
              recipient: { id: 17841457826920658 },
              message: { mid: 'm', text: 'x' },
            },
          ],
        },
      ],
    });
    // ⚠️ 17841457826920658 > Number.MAX_SAFE_INTEGER: como número JS ele já
    // chegou ARREDONDADO, e não há como recuperar. O parser converte o que
    // recebe; quem garante a fidelidade é a Meta mandar string — e manda.
    expect(r.eventos[0]).toMatchObject({
      tipo: 'mensagem',
      remetente: '1663055967608091',
    });
    expect(typeof r.eventos[0].igUserId).toBe('string');
  });
});

describe('midiaDoAnexo', () => {
  it('imagem, vídeo, PDF; share/story/reel e anexo sem URL não são arquivo', () => {
    const u = 'https://cdn/x';
    expect(midiaDoAnexo({ tipo: 'image', url: u, tipoCru: 'image' })).toEqual({
      classe: 'image',
      mime: 'image/jpeg',
    });
    expect(midiaDoAnexo({ tipo: 'video', url: u, tipoCru: 'video' })).toEqual({
      classe: 'video',
      mime: 'video/mp4',
    });
    expect(midiaDoAnexo({ tipo: 'file', url: u, tipoCru: 'file' })).toEqual({
      classe: 'document',
      mime: 'application/pdf',
    });
    for (const tipo of [
      'share',
      'story_mention',
      'reel',
      'ig_reel',
      'outro',
    ] as const) {
      expect(midiaDoAnexo({ tipo, url: u, tipoCru: tipo })).toBeNull();
    }
    expect(
      midiaDoAnexo({ tipo: 'audio', url: null, tipoCru: 'audio' })
    ).toBeNull();
  });
});

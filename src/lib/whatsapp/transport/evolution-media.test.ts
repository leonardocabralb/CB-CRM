import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import type { EvolutionClient } from './evolution-client';
import { fetchAndStoreEvolutionMedia } from './evolution-media';

// ============================================================
// O anexo recebido pela Evolution sobe com o tipo que o BUCKET aceita (1115).
// Até aqui subia com o tipo declarado, e o ZIP do Windows
// (`application/x-zip-compressed`) era recusado: a mensagem ficava sem o
// arquivo, "Documento indisponível".
// ============================================================

const CONTA = '00000000-0000-4000-8000-000000000001';

function cenario(base64: { mimetype: string; fileName?: string }) {
  const uploads: { caminho: string; contentType: string }[] = [];
  const db = {
    storage: {
      from: () => ({
        upload: async (caminho: string, _bytes: Buffer, opcoes: { contentType: string }) => {
          uploads.push({ caminho, contentType: opcoes.contentType });
          return { error: null };
        },
        getPublicUrl: (caminho: string) => ({
          data: { publicUrl: `https://proj.supabase.co/storage/v1/object/public/chat-media/${caminho}` },
        }),
      }),
    },
  } as unknown as SupabaseClient;
  const client = {
    getBase64FromMediaMessage: async () => ({
      base64: Buffer.from('conteudo').toString('base64'),
      ...base64,
    }),
  } as unknown as EvolutionClient;
  return { db, client, uploads };
}

describe('fetchAndStoreEvolutionMedia — o tipo do upload (1115)', () => {
  it('o ZIP do Windows sobe como binário, com o tipo e o nome VERDADEIROS devolvidos', async () => {
    const { db, client, uploads } = cenario({
      mimetype: 'application/x-zip-compressed',
      fileName: 'endereço_Fulano.zip',
    });
    const salva = await fetchAndStoreEvolutionMedia({
      db,
      client,
      accountId: CONTA,
      rawMessage: {},
      contentType: 'document',
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0].contentType).toBe('application/octet-stream');
    expect(uploads[0].caminho).toMatch(/\.zip$/);
    // `media_type` e `media_filename` saem daqui: o tipo declarado, não o guardado.
    expect(salva).toMatchObject({
      filename: 'endereço_Fulano.zip',
      mime: 'application/x-zip-compressed',
    });
  });

  it('o e-mail do Outlook também — todo tipo fora da lista do bucket', async () => {
    const { db, client, uploads } = cenario({
      mimetype: 'application/vnd.ms-outlook',
      fileName: 'RE: proposta.msg',
    });
    const salva = await fetchAndStoreEvolutionMedia({
      db,
      client,
      accountId: CONTA,
      rawMessage: {},
      contentType: 'document',
    });
    expect(uploads[0].contentType).toBe('application/octet-stream');
    expect(salva?.mime).toBe('application/vnd.ms-outlook');
  });

  it('o que o bucket aceita sobe com o próprio tipo, sem parâmetros', async () => {
    const pdf = cenario({ mimetype: 'application/pdf', fileName: 'contrato.pdf' });
    await fetchAndStoreEvolutionMedia({
      db: pdf.db,
      client: pdf.client,
      accountId: CONTA,
      rawMessage: {},
      contentType: 'document',
    });
    expect(pdf.uploads[0].contentType).toBe('application/pdf');

    const voz = cenario({ mimetype: 'audio/ogg; codecs=opus' });
    const salva = await fetchAndStoreEvolutionMedia({
      db: voz.db,
      client: voz.client,
      accountId: CONTA,
      rawMessage: {},
      contentType: 'audio',
    });
    expect(voz.uploads[0].contentType).toBe('audio/ogg');
    expect(salva?.mime).toBe('audio/ogg');
  });
});

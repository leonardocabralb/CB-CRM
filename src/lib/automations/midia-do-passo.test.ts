import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  acervoDosPassos,
  carregarAcervoDosPassos,
  MOTIVO_ITEM_DO_ACERVO_APAGADO,
  origemDaMidiaDoPasso,
  prepararMidiaDoPasso,
} from './midia-do-passo';

// ============================================================
// Passo "Enviar arquivo" das automações (09/11/2026): o arquivo pode vir do
// ACERVO (`acervo_id`), copiado a cada envio, sem quebrar o passo antigo
// (`url`, o arquivo subido no próprio passo).
// ============================================================

const ITEM_ID = '00000000-0000-4000-8000-0000000000a1';

describe('origemDaMidiaDoPasso', () => {
  it('o passo antigo (arquivo subido no passo) continua valendo', () => {
    expect(origemDaMidiaDoPasso({ kind: 'document', url: 'https://x/a.pdf' })).toEqual({
      origem: 'url',
      link: 'https://x/a.pdf',
    });
  });

  it('acervo_id VENCE a URL guardada (ela é só da tela)', () => {
    expect(
      origemDaMidiaDoPasso({ kind: 'video', url: 'https://x/acervo/v.mp4', acervo_id: ` ${ITEM_ID} ` }),
    ).toEqual({ origem: 'acervo', acervoId: ITEM_ID });
  });

  it('sem arquivo = null (acervo_id vazio ou nulo não conta)', () => {
    expect(origemDaMidiaDoPasso({ kind: 'image', url: '' })).toBeNull();
    expect(origemDaMidiaDoPasso({ kind: 'image', url: '  ', acervo_id: '  ' })).toBeNull();
    expect(origemDaMidiaDoPasso({ kind: 'image', url: '', acervo_id: null })).toBeNull();
    expect(origemDaMidiaDoPasso(null)).toBeNull();
  });
});

function bancoComAcervo(opts: {
  item?: Record<string, unknown> | null;
  /** O item na leitura da CÓPIA (a 2ª); ausente = o mesmo da conferência. */
  itemNaCopia?: Record<string, unknown> | null;
  erroLeitura?: string;
  erroCopia?: string;
}) {
  const copias: Array<[string, string]> = [];
  const filtros: Array<[string, unknown]> = [];
  let leituras = 0;
  // O bucket guarda o que já foi copiado: a cópia CONGELADA do item é uma só.
  const bucket = new Set<string>();
  const db = {
    from: () => {
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return b;
        },
        maybeSingle: () => {
          leituras += 1;
          const item = leituras > 1 && 'itemNaCopia' in opts ? opts.itemNaCopia : opts.item;
          return Promise.resolve(
            opts.erroLeitura
              ? { data: null, error: { message: opts.erroLeitura } }
              : { data: item ?? null, error: null },
          );
        },
      };
      return b;
    },
    storage: {
      from: () => ({
        // A forma do storage-js: AUSENTE resolve com data:false E error.
        exists: (p: string) =>
          Promise.resolve(
            bucket.has(p) ? { data: true, error: null } : { data: false, error: { message: 'Object not found' } },
          ),
        copy: (de: string, para: string) => {
          copias.push([de, para]);
          if (opts.erroCopia) return Promise.resolve({ error: { message: opts.erroCopia } });
          bucket.add(para);
          return Promise.resolve({ error: null });
        },
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://storage/${p}` } }),
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, copias, filtros };
}

/** A cópia que o remetente produz (o `link` do acervo é função). */
async function produzir(link: string | (() => Promise<string>)): Promise<string> {
  expect(typeof link).toBe('function');
  return (link as () => Promise<string>)();
}

describe('prepararMidiaDoPasso', () => {
  const VIDEO = {
    id: ITEM_ID,
    tipo: 'video',
    media_path: 'account-acc/acervo/gestante-5-passos.mp4',
    filename: 'gestante-5-passos.mp4',
  };

  it('PASSO ANTIGO: manda a URL do passo como está, sem ler nem copiar nada', async () => {
    const { db, copias, filtros } = bancoComAcervo({});
    const m = await prepararMidiaDoPasso(db, 'acc', {
      kind: 'document',
      url: 'https://storage/account-acc/contrato.pdf',
      filename: 'Contrato.pdf',
    });
    expect(m).toEqual({ kind: 'document', link: 'https://storage/account-acc/contrato.pdf', filename: 'Contrato.pdf' });
    expect(copias).toHaveLength(0);
    expect(filtros).toHaveLength(0);
    // Nome só em documento — o WhatsApp ignora nos outros.
    const imagem = await prepararMidiaDoPasso(db, 'acc', { kind: 'image', url: 'https://x/a.png', filename: 'a.png' });
    expect(imagem.filename).toBeUndefined();
  });

  it('ACERVO: CONFERE o item pela conta agora, e a CÓPIA só quando o remetente pede — o tipo vem do item', async () => {
    const { db, copias, filtros } = bancoComAcervo({ item: VIDEO });
    const m = await prepararMidiaDoPasso(db, 'acc', {
      // o passo diz imagem (foto velha da escolha): quem manda é o item
      kind: 'image',
      url: 'https://storage/account-acc/acervo/gestante-5-passos.mp4',
      acervo_id: ITEM_ID,
    });
    expect(m.kind).toBe('video');
    // Vídeo não leva nome.
    expect(m.filename).toBeUndefined();
    // Cercado pela conta: service role ignora RLS.
    expect(filtros).toContainEqual(['account_id', 'acc']);
    expect(filtros).toContainEqual(['id', ITEM_ID]);
    // Conferir não copia: a recusa do remetente (Instagram, sem telefone) não deixa órfão.
    expect(copias).toHaveLength(0);

    const link = await produzir(m.link);
    expect(copias).toHaveLength(1);
    expect(copias[0][0]).toBe(VIDEO.media_path);
    // UMA cópia por item (09/11/2026), em acervo/enviados/<item>/ — e a URL
    // que vai ao WhatsApp e ao fio é a DELA, nunca a do item.
    expect(copias[0][1]).toBe(`account-acc/acervo/enviados/${ITEM_ID}/gestante-5-passos.mp4`);
    expect(link).toBe(`https://storage/${copias[0][1]}`);
    expect(link).not.toBe('https://storage/account-acc/acervo/gestante-5-passos.mp4');
  });

  it('ACERVO: UMA cópia por item — os envios seguintes reaproveitam a congelada (09/11/2026)', async () => {
    const { db, copias } = bancoComAcervo({ item: VIDEO });
    const m = await prepararMidiaDoPasso(db, 'acc', { kind: 'video', url: '', acervo_id: ITEM_ID });
    const primeiro = await produzir(m.link);
    const segundo = await produzir(m.link);
    const outraExecucao = await produzir(
      (await prepararMidiaDoPasso(db, 'acc', { kind: 'video', url: '', acervo_id: ITEM_ID })).link,
    );
    expect(copias).toHaveLength(1);
    expect(new Set([primeiro, segundo, outraExecucao]).size).toBe(1);
  });

  it('ACERVO, documento: o nome editado no passo vence; vazio cai no do item', async () => {
    const PDF = { ...VIDEO, tipo: 'document', media_path: 'account-acc/acervo/guia.pdf', filename: 'guia.pdf' };
    const editado = await prepararMidiaDoPasso(bancoComAcervo({ item: PDF }).db, 'acc', {
      kind: 'document',
      url: '',
      acervo_id: ITEM_ID,
      filename: 'Guia da gestante.pdf',
    });
    expect(editado.filename).toBe('Guia da gestante.pdf');
    const vazio = await prepararMidiaDoPasso(bancoComAcervo({ item: PDF }).db, 'acc', {
      kind: 'document',
      url: '',
      acervo_id: ITEM_ID,
      filename: '  ',
    });
    expect(vazio.filename).toBe('guia.pdf');
  });

  it('ACERVO: item apagado falha com o motivo claro na CONFERÊNCIA — e nunca cai para a URL guardada', async () => {
    const { db, copias } = bancoComAcervo({ item: null });
    await expect(
      prepararMidiaDoPasso(db, 'acc', { kind: 'video', url: 'https://storage/acervo/velho.mp4', acervo_id: ITEM_ID }),
    ).rejects.toThrow(MOTIVO_ITEM_DO_ACERVO_APAGADO);
    expect(copias).toHaveLength(0);
  });

  it('ACERVO: apagado ENTRE a conferência e o envio — a cópia falha com o mesmo motivo', async () => {
    const { db, copias } = bancoComAcervo({ item: VIDEO, itemNaCopia: null });
    const m = await prepararMidiaDoPasso(db, 'acc', { kind: 'video', url: '', acervo_id: ITEM_ID });
    await expect(produzir(m.link)).rejects.toThrow(MOTIVO_ITEM_DO_ACERVO_APAGADO);
    expect(copias).toHaveLength(0);
  });

  it('ACERVO: erro de BANCO é leitura, NUNCA "apagado"', async () => {
    const erro = await prepararMidiaDoPasso(bancoComAcervo({ erroLeitura: 'timeout' }).db, 'acc', {
      kind: 'video',
      url: 'https://storage/acervo/velho.mp4',
      acervo_id: ITEM_ID,
    }).catch((e: unknown) => e);
    expect(String(erro)).toMatch(/leitura do acervo falhou \(timeout\)/);
    expect(String(erro)).not.toMatch(/apagado/);
  });

  it('ACERVO: o Storage recusou a cópia — a função falha, nada é enviado', async () => {
    const { db } = bancoComAcervo({ item: VIDEO, erroCopia: 'The resource already exists' });
    const m = await prepararMidiaDoPasso(db, 'acc', { kind: 'video', url: '', acervo_id: ITEM_ID });
    await expect(produzir(m.link)).rejects.toThrow(
      /cópia do arquivo do acervo falhou \(The resource already exists\)/,
    );
  });

  it('sem arquivo nenhum: falha antes de qualquer leitura', async () => {
    const { db, copias, filtros } = bancoComAcervo({ item: VIDEO });
    await expect(prepararMidiaDoPasso(db, 'acc', { kind: 'image', url: '' })).rejects.toThrow(
      'send_media precisa de um arquivo',
    );
    expect(copias).toHaveLength(0);
    expect(filtros).toHaveLength(0);
  });
});

describe('acervoDosPassos', () => {
  it('os itens dos "Enviar arquivo", ramos inclusive, sem repetir', () => {
    const outro = '00000000-0000-4000-8000-0000000000b2';
    const passos = [
      { step_type: 'send_media', step_config: { kind: 'video', acervo_id: ITEM_ID } },
      {
        step_type: 'condition',
        step_config: {},
        branches: {
          yes: [{ step_type: 'send_media', step_config: { kind: 'document', acervo_id: ` ${outro} ` } }],
          no: [{ step_type: 'send_media', step_config: { kind: 'video', acervo_id: ITEM_ID } }],
        },
      },
    ];
    expect(acervoDosPassos(passos).sort()).toEqual([ITEM_ID, outro].sort());
  });

  it('fica de fora: passo sem acervo, outro tipo de passo e id sem forma de UUID (derrubaria a consulta)', () => {
    expect(
      acervoDosPassos([
        { step_type: 'send_media', step_config: { kind: 'image', url: 'https://x/a.png' } },
        { step_type: 'send_message', step_config: { acervo_id: ITEM_ID } },
        { step_type: 'send_media', step_config: { kind: 'image', acervo_id: 'nao-e-uuid' } },
      ]),
    ).toEqual([]);
  });
});

describe('carregarAcervoDosPassos', () => {
  function bancoDaLista(resposta: { data: unknown; error: { message: string } | null }) {
    const consultas: Array<{ tabela: string; filtros: unknown[][] }> = [];
    const db = {
      from: (tabela: string) => {
        const filtros: unknown[][] = [];
        consultas.push({ tabela, filtros });
        const b = {
          select: () => b,
          eq: (c: string, v: unknown) => (filtros.push(['eq', c, v]), b),
          in: (c: string, v: unknown) => {
            filtros.push(['in', c, v]);
            return Promise.resolve(resposta);
          },
        };
        return b;
      },
    };
    return { db: db as unknown as SupabaseClient, consultas };
  }
  const passos = [{ step_type: 'send_media', step_config: { kind: 'video', acervo_id: ITEM_ID } }];

  it('lê só os itens apontados, cercado pela CONTA', async () => {
    const { db, consultas } = bancoDaLista({ data: [{ id: ITEM_ID }], error: null });
    expect(await carregarAcervoDosPassos(db, 'acc', passos)).toEqual(new Set([ITEM_ID]));
    expect(consultas).toEqual([
      {
        tabela: 'cb_media_library',
        filtros: [
          ['eq', 'account_id', 'acc'],
          ['in', 'id', [ITEM_ID]],
        ],
      },
    ]);
  });

  it('item que não voltou (apagado ou de outra conta) fica fora do conjunto', async () => {
    const { db } = bancoDaLista({ data: [], error: null });
    expect((await carregarAcervoDosPassos(db, 'acc', passos))?.has(ITEM_ID)).toBe(false);
  });

  it('sem passo do acervo: conjunto vazio, sem consulta', async () => {
    const { db, consultas } = bancoDaLista({ data: [], error: null });
    expect(await carregarAcervoDosPassos(db, 'acc', [{ step_type: 'send_message', step_config: {} }])).toEqual(
      new Set(),
    );
    expect(consultas).toHaveLength(0);
  });

  it('leitura que falha = null (a conferência é pulada), nunca "apagado"', async () => {
    const { db } = bancoDaLista({ data: null, error: { message: 'timeout' } });
    expect(await carregarAcervoDosPassos(db, 'acc', passos)).toBeNull();
  });
});

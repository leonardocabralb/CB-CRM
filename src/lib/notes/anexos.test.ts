import fs from 'node:fs';
import path from 'node:path';

import { StorageClient } from '@supabase/storage-js';
import { describe, expect, it } from 'vitest';

import { MEDIA_MAX_BYTES_ENTRADA } from '@/lib/storage/upload-media';

import {
  ACEITE_DA_ANOTACAO,
  MAX_ANEXOS_DA_NOTA,
  MAX_NOME_DO_ANEXO,
  MIMES_DA_ANOTACAO,
  TETO_DO_ANEXO,
  TETO_DO_CORPO_DO_AVISO,
  caminhoDoAnexoDaNota,
  conferirAnexo,
  corpoDoAviso,
  cortarSemPartir,
  escolherAnexosDaNota,
  lerAnexosDaNota,
  lerAnexosDoCorpo,
  mantidosSaoDaNota,
  nomeDaGravacao,
  prefixoDasNotas,
  resumoDosAnexos,
  textoDoResumo,
  tipoDoAnexo,
  urlPublicaDoAnexo,
  type AnexoDaNota,
} from './anexos';

// ============================================================
// Anexos da anotação (1102). A régua que a caixa, a rota e as telas leem —
// e os dois números que também vivem no banco e no bucket.
// ============================================================

const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const CONTA = '00000000-0000-0000-0000-000000000001';
const OUTRA = '00000000-0000-0000-0000-000000000002';
const PREFIXO = `account-${CONTA}/notas/`;

function sql(arquivo: string): string {
  return fs
    .readFileSync(path.join(MIGRATIONS, arquivo), 'utf8')
    .replace(/--[^\n]*/g, '');
}

function anexo(parcial: Partial<AnexoDaNota>): AnexoDaNota {
  return {
    caminho: `${PREFIXO}u1/a.pdf`,
    nome: 'a.pdf',
    mime: 'application/pdf',
    bytes: 10,
    ...parcial,
  };
}

describe('os números que moram em dois lugares', () => {
  it('todo tipo da anotação cabe na lista do bucket (a da 0042 + o .html da 1060)', () => {
    const lista = sql('0042_inbound_media_mirror.sql').match(
      /allowed_mime_types\)\s*VALUES\s*\([\s\S]*?ARRAY\[([\s\S]*?)\]/
    );
    expect(lista, 'a lista do bucket sumiu da 0042').not.toBeNull();
    const doBucket = new Set(
      [...lista![1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    );
    expect(sql('1060_cb_cartao_de_contato.sql')).toMatch(
      /array_append\(allowed_mime_types, 'text\/html'\)/
    );
    doBucket.add('text/html');
    const fora = MIMES_DA_ANOTACAO.filter((m) => !doBucket.has(m));
    expect(fora).toEqual([]);
  });

  it('o teto por arquivo é o do bucket (A7: 50 MiB)', () => {
    expect(TETO_DO_ANEXO).toBe(50 * 1024 * 1024);
    expect(TETO_DO_ANEXO).toBe(MEDIA_MAX_BYTES_ENTRADA);
  });

  it('o teto de anexos é o do CHECK da 1102 (10)', () => {
    expect(MAX_ANEXOS_DA_NOTA).toBe(10);
    expect(sql('1102_cb_anotacao_com_anexos.sql')).toMatch(
      new RegExp(`jsonb_array_length\\(anexos\\) <= ${MAX_ANEXOS_DA_NOTA}\\b`)
    );
  });
});

describe('tipos', () => {
  it('áudio, imagem, vídeo e documento (com o .html); o resto, não', () => {
    expect(tipoDoAnexo('audio/ogg')).toBe('audio');
    expect(tipoDoAnexo('audio/mpeg')).toBe('audio');
    expect(tipoDoAnexo('image/png; charset=binary')).toBe('imagem');
    expect(tipoDoAnexo('video/mp4')).toBe('video');
    expect(tipoDoAnexo('application/pdf')).toBe('documento');
    expect(tipoDoAnexo('text/html')).toBe('documento');
    expect(tipoDoAnexo('text/plain')).toBe('documento');
    expect(tipoDoAnexo('audio/webm')).toBeNull();
    expect(tipoDoAnexo('image/gif')).toBeNull();
    expect(tipoDoAnexo('application/zip')).toBeNull();
    expect(tipoDoAnexo('')).toBeNull();
    expect(tipoDoAnexo(null)).toBeNull();
  });

  it('o accept= do clipe é a MESMA lista', () => {
    expect(ACEITE_DA_ANOTACAO.split(',')).toEqual([...MIMES_DA_ANOTACAO]);
    expect(MIMES_DA_ANOTACAO).toContain('text/html');
    expect(MIMES_DA_ANOTACAO).toContain('audio/ogg');
  });
});

describe('caminho', () => {
  it('uma pasta por arquivo em notas/, com o nome no fim', () => {
    const c = caminhoDoAnexoDaNota(CONTA, 'Contrato São Paulo.PDF', 'abc-123');
    expect(c).toBe(`${PREFIXO}abc-123/Contrato_S_o_Paulo.pdf`);
    expect(c.startsWith(prefixoDasNotas(CONTA))).toBe(true);
  });

  it('o caminho que a caixa gera passa na leitura da rota', () => {
    const caminho = caminhoDoAnexoDaNota(CONTA, 'audio-1.ogg', 'f0e1d2c3-0000-4000-8000-000000000001');
    expect(lerAnexosDoCorpo([{ caminho, nome: 'audio-1.ogg' }], CONTA)).toEqual({
      ok: true,
      anexos: [{ caminho, nome: 'audio-1.ogg' }],
    });
  });
});

describe('lerAnexosDoCorpo', () => {
  it('ausente ou nulo = nenhum', () => {
    expect(lerAnexosDoCorpo(undefined, CONTA)).toEqual({ ok: true, anexos: [] });
    expect(lerAnexosDoCorpo(null, CONTA)).toEqual({ ok: true, anexos: [] });
  });

  it('forma torta é recusada', () => {
    for (const valor of [
      'x',
      { caminho: `${PREFIXO}u/a.pdf` },
      [null],
      [[`${PREFIXO}u/a.pdf`]],
      [{ caminho: `${PREFIXO}u/a.pdf` }],
      [{ caminho: 1, nome: 'a' }],
    ]) {
      expect(lerAnexosDoCorpo(valor, CONTA)).toEqual({
        ok: false,
        erro: 'ATTACHMENTS_INVALID',
      });
    }
  });

  it('mais de 10 é recusado', () => {
    const onze = Array.from({ length: 11 }, (_, i) => ({
      caminho: `${PREFIXO}u${i}/a.pdf`,
      nome: 'a.pdf',
    }));
    expect(lerAnexosDoCorpo(onze, CONTA)).toEqual({
      ok: false,
      erro: 'TOO_MANY_ATTACHMENTS',
    });
    expect(lerAnexosDoCorpo(onze.slice(0, 10), CONTA)).toMatchObject({ ok: true });
  });

  it('só o caminho DESTA conta, em notas/, e que passa na guarda da 1097', () => {
    for (const caminho of [
      `account-${OUTRA}/notas/u/a.pdf`,
      `account-${CONTA}/u/a.pdf`,
      `account-${CONTA}/acervo/a.pdf`,
      `account-${CONTA}/notas/../a.pdf`,
      `account-${CONTA}/notas/u/a%20b.pdf`,
      `account-${CONTA}/notas//a.pdf`,
      `account-${CONTA}/notas/u/`,
      `https://x.supabase.co/storage/v1/object/public/chat-media/${PREFIXO}u/a.pdf`,
    ]) {
      expect(lerAnexosDoCorpo([{ caminho, nome: 'a' }], CONTA), caminho).toEqual({
        ok: false,
        erro: 'ATTACHMENT_OUTSIDE_ACCOUNT',
      });
    }
  });

  it('o mesmo caminho duas vezes é recusado', () => {
    const um = { caminho: `${PREFIXO}u/a.pdf`, nome: 'a.pdf' };
    expect(lerAnexosDoCorpo([um, { ...um, nome: 'b' }], CONTA)).toEqual({
      ok: false,
      erro: 'ATTACHMENT_REPEATED',
    });
  });

  it('o nome é aparado, sem caractere de controle, com teto; vazio vira o fim do caminho', () => {
    const r = lerAnexosDoCorpo(
      [
        { caminho: `${PREFIXO}u1/a.pdf`, nome: '  Contrato\u0000 final.pdf \n' },
        { caminho: `${PREFIXO}u2/b.pdf`, nome: '   ' },
        { caminho: `${PREFIXO}u3/c.pdf`, nome: 'x'.repeat(300) },
      ],
      CONTA
    );
    expect(r).toMatchObject({ ok: true });
    const anexos = r.ok ? r.anexos : [];
    expect(anexos[0].nome).toBe('Contrato final.pdf');
    expect(anexos[1].nome).toBe('b.pdf');
    expect(anexos[2].nome).toHaveLength(MAX_NOME_DO_ANEXO);
  });

  it('o teto do nome nunca parte um emoji (a metade solta o Postgres recusa: 22P02)', () => {
    // 199 letras + 😀 = 201 unidades: o corte em 200 caía no MEIO do emoji.
    const nome = `${'a'.repeat(MAX_NOME_DO_ANEXO - 1)}😀.pdf`;
    const r = lerAnexosDoCorpo([{ caminho: `${PREFIXO}u1/a.pdf`, nome }], CONTA);
    const gravado = r.ok ? r.anexos[0].nome : '';
    expect(gravado).toBe('a'.repeat(MAX_NOME_DO_ANEXO - 1));
    expect(temMetadeSolta(gravado)).toBe(false);
    // E o que cabe inteiro fica inteiro, emoji incluído.
    const cabe = `${'a'.repeat(MAX_NOME_DO_ANEXO - 2)}😀`;
    const r2 = lerAnexosDoCorpo([{ caminho: `${PREFIXO}u1/a.pdf`, nome: cabe }], CONTA);
    expect(r2.ok ? r2.anexos[0].nome : '').toBe(cabe);
  });
});

/** Uma unidade UTF-16 de par sem a outra metade — o que o Postgres recusa. */
function temMetadeSolta(texto: string): boolean {
  return /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(texto);
}

describe('cortarSemPartir', () => {
  it('corta em unidades UTF-16 e tira a metade alta que sobraria no fim', () => {
    expect(cortarSemPartir('abc', 5)).toBe('abc');
    expect(cortarSemPartir('abcdef', 3)).toBe('abc');
    expect(cortarSemPartir('ab😀', 3)).toBe('ab');
    expect(cortarSemPartir('ab😀', 4)).toBe('ab😀');
    expect(cortarSemPartir('😀😀', 3)).toBe('😀');
    for (let max = 0; max <= 12; max++) {
      const corte = cortarSemPartir('a😀b🎤c📄', max);
      expect(corte.length, String(max)).toBeLessThanOrEqual(max);
      expect(temMetadeSolta(corte), String(max)).toBe(false);
    }
  });
});

describe('conferirAnexo (o que o armazenamento diz)', () => {
  const pedido = { caminho: `${PREFIXO}u/a.ogg`, nome: 'a.ogg' };

  it('tipo da lista e tamanho no teto: grava o tipo normalizado e o tamanho LIDO', () => {
    expect(conferirAnexo(pedido, { bytes: 4096, mime: 'audio/ogg; codecs=opus' })).toEqual({
      ok: true,
      anexo: { ...pedido, mime: 'audio/ogg', bytes: 4096 },
    });
  });

  it('tipo fora da lista ou acima do teto é recusado', () => {
    expect(conferirAnexo(pedido, { bytes: 1, mime: 'image/gif' })).toEqual({
      ok: false,
      erro: 'ATTACHMENT_TYPE_REFUSED',
    });
    expect(conferirAnexo(pedido, { bytes: TETO_DO_ANEXO + 1, mime: 'audio/ogg' })).toEqual({
      ok: false,
      erro: 'ATTACHMENT_TOO_LARGE',
    });
    expect(conferirAnexo(pedido, { bytes: TETO_DO_ANEXO, mime: 'audio/ogg' })).toMatchObject({
      ok: true,
    });
  });
});

describe('lerAnexosDaNota (o JSON gravado, para mostrar)', () => {
  it('lê campo a campo e descarta o que não tem caminho', () => {
    expect(
      lerAnexosDaNota([
        { caminho: `${PREFIXO}u/a.pdf`, nome: 'a.pdf', mime: 'application/pdf', bytes: 3 },
        { caminho: `${PREFIXO}u/b.ogg`, nome: '  ', mime: 7, bytes: '9' },
        { nome: 'sem caminho' },
        'texto solto',
        null,
      ])
    ).toEqual([
      { caminho: `${PREFIXO}u/a.pdf`, nome: 'a.pdf', mime: 'application/pdf', bytes: 3 },
      { caminho: `${PREFIXO}u/b.ogg`, nome: 'b.ogg', mime: '', bytes: 0 },
    ]);
  });

  it('o que não é lista vira nenhum (a linha anterior à 1102, o tempo real)', () => {
    expect(lerAnexosDaNota(undefined)).toEqual([]);
    expect(lerAnexosDaNota(null)).toEqual([]);
    expect(lerAnexosDaNota({ caminho: 'x' })).toEqual([]);
  });
});

describe('mantidosSaoDaNota (Fase 3: o que FICA na edição)', () => {
  const daNota = [
    { caminho: `${PREFIXO}u1/a.ogg`, nome: 'a.ogg', mime: 'audio/ogg', bytes: 10 },
    { caminho: `${PREFIXO}u2/b.pdf`, nome: 'b.pdf', mime: 'application/pdf', bytes: 20 },
    { caminho: `${PREFIXO}u3/c.png`, nome: 'c.png', mime: 'image/png', bytes: 30 },
  ];

  it('ausente ou nulo é RECUSADO: tirar todos é `[]` explícito (um corpo sem o campo apagaria os anexos)', () => {
    expect(mantidosSaoDaNota(undefined, daNota)).toEqual({ ok: false, erro: 'ATTACHMENTS_INVALID' });
    expect(mantidosSaoDaNota(null, daNota)).toEqual({ ok: false, erro: 'ATTACHMENTS_INVALID' });
    expect(mantidosSaoDaNota([], daNota)).toEqual({ ok: true, anexos: [] });
  });

  it('o que fica é o que a NOTA guarda (nome, tipo e tamanho dela), na ordem pedida', () => {
    expect(mantidosSaoDaNota([`${PREFIXO}u3/c.png`, `${PREFIXO}u1/a.ogg`], daNota)).toEqual({
      ok: true,
      anexos: [daNota[2], daNota[0]],
    });
  });

  it('caminho que a nota NÃO tem é recusado, dizendo qual — nem de outra nota da conta', () => {
    expect(mantidosSaoDaNota([`${PREFIXO}u9/outra.pdf`], daNota)).toEqual({
      ok: false,
      erro: 'ATTACHMENT_NOT_IN_NOTE',
      caminho: `${PREFIXO}u9/outra.pdf`,
    });
    // Nota sem anexo: nada pode "ficar".
    expect(mantidosSaoDaNota([`${PREFIXO}u1/a.ogg`], [])).toMatchObject({
      ok: false,
      erro: 'ATTACHMENT_NOT_IN_NOTE',
    });
  });

  it('forma torta e repetição são recusadas', () => {
    expect(mantidosSaoDaNota('x', daNota)).toEqual({ ok: false, erro: 'ATTACHMENTS_INVALID' });
    expect(mantidosSaoDaNota([{ caminho: `${PREFIXO}u1/a.ogg` }], daNota)).toEqual({
      ok: false,
      erro: 'ATTACHMENTS_INVALID',
    });
    expect(mantidosSaoDaNota([`${PREFIXO}u1/a.ogg`, `${PREFIXO}u1/a.ogg`], daNota)).toEqual({
      ok: false,
      erro: 'ATTACHMENT_REPEATED',
      caminho: `${PREFIXO}u1/a.ogg`,
    });
  });
});

describe('urlPublicaDoAnexo', () => {
  it('é a MESMA URL que o getPublicUrl do storage-js gera', () => {
    const base = 'https://projeto.supabase.co';
    const caminho = `${PREFIXO}u1/Contrato_final.pdf`;
    const doStorage = new StorageClient(`${base}/storage/v1`, {})
      .from('chat-media')
      .getPublicUrl(caminho).data.publicUrl;
    expect(urlPublicaDoAnexo(caminho, base)).toBe(doStorage);
    expect(urlPublicaDoAnexo(caminho, `${base}/`)).toBe(doStorage);
  });
});

describe('resumo e corpo do aviso', () => {
  it('um anexo pelo tipo; vários pela contagem', () => {
    expect(resumoDosAnexos([])).toBeNull();
    expect(textoDoResumo(resumoDosAnexos([anexo({ mime: 'audio/ogg' })])!)).toBe('🎤 Áudio');
    expect(textoDoResumo(resumoDosAnexos([anexo({ mime: 'image/png' })])!)).toBe('🖼️ Imagem');
    expect(textoDoResumo(resumoDosAnexos([anexo({ mime: 'video/mp4' })])!)).toBe('🎬 Vídeo');
    expect(textoDoResumo(resumoDosAnexos([anexo({ nome: 'contrato.pdf' })])!)).toBe('📄 contrato.pdf');
    expect(textoDoResumo(resumoDosAnexos([anexo({}), anexo({}), anexo({})])!)).toBe('📎 3 anexos');
  });

  it('o corpo: o texto, e o resumo depois dele; sem texto, só o resumo', () => {
    expect(corpoDoAviso('  @Ana confere  ', [])).toBe('@Ana confere');
    expect(corpoDoAviso('@Ana confere', [anexo({ mime: 'audio/ogg' })])).toBe(
      '@Ana confere · 🎤 Áudio'
    );
    expect(corpoDoAviso('   ', [anexo({ mime: 'audio/ogg' })])).toBe('🎤 Áudio');
  });

  it('o texto encolhe para o resumo caber no teto', () => {
    const corpo = corpoDoAviso('x'.repeat(500), [anexo({}), anexo({})]);
    expect(corpo.length).toBeLessThanOrEqual(TETO_DO_CORPO_DO_AVISO);
    expect(corpo.endsWith(' · 📎 2 anexos')).toBe(true);
  });

  it('nenhum corte do corpo parte um emoji — com e sem anexo, em toda posição', () => {
    for (let n = 260; n <= 290; n++) {
      const texto = `${'x'.repeat(n)}😀😀😀`;
      for (const anexos of [[], [anexo({ mime: 'audio/ogg' })]]) {
        const corpo = corpoDoAviso(texto, anexos);
        expect(corpo.length, `${n}/${anexos.length}`).toBeLessThanOrEqual(TETO_DO_CORPO_DO_AVISO);
        expect(temMetadeSolta(corpo), `${n}/${anexos.length}`).toBe(false);
      }
    }
    // O resumo de um documento de nome longo com emoji, sem texto.
    const longo = anexo({ nome: `${'d'.repeat(TETO_DO_CORPO_DO_AVISO - 4)}😀😀.pdf` });
    expect(temMetadeSolta(corpoDoAviso('', [longo]))).toBe(false);
  });
});

describe('a frase da recusa diz a verdade sobre os formatos (os dois dicionários)', () => {
  const dicionarios = ['pt-BR', 'en'].map((idioma) => {
    const arquivo = path.join(__dirname, '..', '..', '..', 'messages', `${idioma}.json`);
    const json = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return { idioma, frase: json.Inbox.composer.noteAttachmentRefused as string };
  });

  it('os áudios que ela nomeia são aceitos, e os que ela deixa de fora são recusados', () => {
    // Nomeados na frase: cada um entra pela régua da anotação.
    for (const mime of ['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/amr']) {
      expect(tipoDoAnexo(mime), mime).toBe('audio');
    }
    // Os que o operador grava/recebe e a régua RECUSA: a frase não os promete.
    for (const mime of ['audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/webm']) {
      expect(tipoDoAnexo(mime), mime).toBeNull();
    }
    for (const { idioma, frase } of dicionarios) {
      for (const nome of ['OGG', 'MP3', 'AAC', 'AMR']) expect(frase, idioma).toContain(nome);
      for (const nome of ['M4A', 'WAV', 'WebM', 'WEBM']) expect(frase, idioma).not.toContain(nome);
    }
  });
});

describe('a caixa', () => {
  it('o nome da gravação leva o carimbo', () => {
    expect(nomeDaGravacao(new Date('2026-10-23T15:30:12Z'))).toBe(
      'audio-20261023-153012.ogg'
    );
  });

  it('escolher: tipo recusado, grande demais e o que passa de 10 (no TOTAL) têm contagem própria', () => {
    const pdf = (n: number) => new File(['x'], `${n}.pdf`, { type: 'application/pdf' });
    const grande = new File(['x'], 'grande.mp4', { type: 'video/mp4' });
    Object.defineProperty(grande, 'size', { value: TETO_DO_ANEXO + 1 });
    const zip = new File(['x'], 'a.zip', { type: 'application/zip' });
    const r = escolherAnexosDaNota([pdf(1), zip, grande, pdf(2), pdf(3)], 8);
    expect(r.aceitos.map((a) => a.name)).toEqual(['1.pdf', '2.pdf']);
    expect(r.recusados).toBe(1);
    expect(r.grandes).toBe(1);
    expect(r.excedentes).toBe(1);
  });
});

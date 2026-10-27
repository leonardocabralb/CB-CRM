import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BINARIO_GENERICO,
  guardadoComoBinario,
  MIMES_DO_CHAT_MEDIA,
  tipoParaGuardar,
} from './tipos-do-chat-media';

// ============================================================
// O espelho da lista do bucket `chat-media` (1115). Tipo no espelho que o
// bucket não aceita = o upload é recusado e o anexo vira "Documento
// indisponível" de novo — o defeito que a 1115 conserta.
// ============================================================

const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');

function sql(arquivo: string): string {
  return fs.readFileSync(path.join(MIGRATIONS, arquivo), 'utf8').replace(/--[^\n]*/g, '');
}

function aspas(trecho: string): string[] {
  return [...trecho.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('MIMES_DO_CHAT_MEDIA', () => {
  it('é a lista do bucket: a da 0042, o .html da 1060 e os tipos da 1115 — nem mais, nem menos', () => {
    const da0042 = sql('0042_inbound_media_mirror.sql').match(
      /allowed_mime_types\)\s*VALUES\s*\([\s\S]*?ARRAY\[([\s\S]*?)\]/,
    );
    expect(da0042, 'a lista do bucket sumiu da 0042').not.toBeNull();
    expect(sql('1060_cb_cartao_de_contato.sql')).toMatch(
      /array_append\(allowed_mime_types, 'text\/html'\)/,
    );
    const da1115 = sql('1115_cb_chat_media_recebe_todo_arquivo.sql').match(
      /unnest\(ARRAY\[([\s\S]*?)\]::text\[\]\) WITH ORDINALITY/,
    );
    expect(da1115, 'a lista da 1115 mudou de forma').not.toBeNull();

    const doBucket = [...aspas(da0042![1]), 'text/html', ...aspas(da1115![1])];
    expect(new Set(doBucket).size, 'tipo repetido entre as migrations').toBe(doBucket.length);
    expect([...MIMES_DO_CHAT_MEDIA].sort()).toEqual([...doBucket].sort());
  });

  it('o binário genérico está na lista: é para onde vai todo o resto', () => {
    expect(MIMES_DO_CHAT_MEDIA).toContain(BINARIO_GENERICO);
  });

  it('⚠️ nada que o navegador EXECUTE entra com o tipo verdadeiro além do .html (que só baixa)', () => {
    expect(MIMES_DO_CHAT_MEDIA).not.toContain('image/svg+xml');
    expect(MIMES_DO_CHAT_MEDIA).not.toContain('application/xhtml+xml');
    expect(MIMES_DO_CHAT_MEDIA).not.toContain('application/javascript');
    expect(MIMES_DO_CHAT_MEDIA).not.toContain('text/javascript');
  });
});

describe('tipoParaGuardar', () => {
  it('o que o bucket aceita vai com o próprio tipo, sem parâmetros', () => {
    expect(tipoParaGuardar('application/pdf')).toBe('application/pdf');
    expect(tipoParaGuardar('audio/ogg; codecs=opus')).toBe('audio/ogg');
    expect(tipoParaGuardar('Audio/MP3')).toBe('audio/mp3');
    expect(tipoParaGuardar('video/mp4')).toBe('video/mp4');
  });

  it('o resto vai como binário — os tipos medidos em produção e o que ninguém previu', () => {
    for (const tipo of [
      'application/x-zip-compressed',
      'application/zip',
      'application/vnd.ms-outlook',
      'application/vnd.rar',
      'application/x-7z-compressed',
      'text/csv',
      'image/svg+xml',
    ]) {
      expect(tipoParaGuardar(tipo), tipo).toBe(BINARIO_GENERICO);
    }
  });

  it('tipo ausente ou vazio também vira binário', () => {
    expect(tipoParaGuardar(null)).toBe(BINARIO_GENERICO);
    expect(tipoParaGuardar('')).toBe(BINARIO_GENERICO);
  });
});

describe('guardadoComoBinario', () => {
  it('liga para o que foi como binário, inclusive o binário declarado', () => {
    expect(guardadoComoBinario('application/x-zip-compressed')).toBe(true);
    expect(guardadoComoBinario('application/octet-stream')).toBe(true);
  });

  it('desliga para o tipo da lista e para tipo AUSENTE (linha de antes da 969)', () => {
    expect(guardadoComoBinario('application/pdf')).toBe(false);
    expect(guardadoComoBinario('image/jpeg')).toBe(false);
    expect(guardadoComoBinario(null)).toBe(false);
    expect(guardadoComoBinario('  ')).toBe(false);
  });
});

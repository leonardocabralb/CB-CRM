import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { audioViraNotaDeVozNaMeta, ehTipoDaMidiaDoNo } from './tipo-da-midia';

// ============================================================
// Os tipos do "Enviar mídia" do robô, e o que o áudio vira no número oficial
// (26/09/2026).
// ============================================================

describe('ehTipoDaMidiaDoNo', () => {
  it('imagem, vídeo, documento e áudio; o resto não', () => {
    for (const t of ['image', 'video', 'document', 'audio']) expect(ehTipoDaMidiaDoNo(t)).toBe(true);
    for (const t of ['sticker', '', null, 3]) expect(ehTipoDaMidiaDoNo(t)).toBe(false);
  });
});

describe('audioViraNotaDeVozNaMeta', () => {
  it('só OGG vira nota de voz pelo número oficial', () => {
    expect(audioViraNotaDeVozNaMeta('audio/ogg')).toBe(true);
    expect(audioViraNotaDeVozNaMeta(' Audio/OGG; codecs=opus ')).toBe(true);
  });

  it('mp3, m4a, aac e amr chegam como ARQUIVO de áudio', () => {
    for (const m of ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', '', null, undefined]) {
      expect(audioViraNotaDeVozNaMeta(m)).toBe(false);
    }
  });
});

describe('o validador continua leve para o navegador', () => {
  it('validate.ts não importa a cópia do acervo (Storage) — nem direto, nem por midia-do-no', () => {
    const fonte = fs.readFileSync(path.join(__dirname, 'validate.ts'), 'utf8');
    const imports = [...fonte.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).not.toContain('./midia-do-no');
    expect(imports.some((i) => i.startsWith('@/lib/acervo'))).toBe(false);
  });
});

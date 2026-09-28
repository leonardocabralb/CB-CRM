import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Pinos da 1060 (cartão de contato + .html no bucket). O replay do CI prova
// que ela APLICA; estes provam o que ela NÃO pode perder numa edição ou num
// merge do upstream que recrie o CHECK de `messages.content_type`.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1060_cb_cartao_de_contato.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('1060 — messages.content_type aceita o cartão de contato', () => {
  it('o CHECK recriado leva o contact E todos os tipos de antes', () => {
    const check = /ADD CONSTRAINT messages_content_type_check\s+CHECK \(content_type IN \(([\s\S]*?)\)\);/.exec(
      semComentarios,
    )?.[1];
    expect(check).toBeDefined();
    for (const tipo of [
      'text',
      'image',
      'document',
      'audio',
      'video',
      'location',
      'template',
      'interactive',
      'system',
      'call',
      'contact',
    ]) {
      expect(check).toContain(`'${tipo}'`);
    }
  });

  it('a coluna dos contatos é jsonb, e a trava tem teto de espera', () => {
    expect(semComentarios).toMatch(/ALTER TABLE messages ADD COLUMN IF NOT EXISTS contatos jsonb;/);
    expect(semComentarios).toMatch(/SET LOCAL lock_timeout = '5s';/);
  });
});

describe('1060 — chat-media aceita .html sem perder o resto', () => {
  it('acrescenta à lista (nunca a reescreve), e nunca sobre lista NULA ("aceita tudo")', () => {
    expect(semComentarios).toMatch(/array_append\(allowed_mime_types, 'text\/html'\)/);
    expect(semComentarios).toMatch(/allowed_mime_types IS NOT NULL/);
    expect(semComentarios).toMatch(/NOT \('text\/html' = ANY \(allowed_mime_types\)\)/);
    // O upsert inteiro da 023/042 reescreveria o teto de 50 MiB da 986.
    expect(semComentarios).not.toMatch(/INSERT INTO storage\.buckets/i);
    expect(semComentarios).not.toMatch(/file_size_limit\s*=/i);
  });
});

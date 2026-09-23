import { describe, expect, it } from 'vitest';
import { parseBroadcastCsv } from './broadcast-csv';

describe('parseBroadcastCsv', () => {
  it('parses phone + name into the audience shape', () => {
    const result = parseBroadcastCsv(
      `phone,name
+15551230000,Ada
+15559990000,Grace`
    );

    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [
        { phone: '15551230000', name: 'Ada' },
        { phone: '15559990000', name: 'Grace' },
      ],
    });
  });

  it('omits name when the column is absent', () => {
    const result = parseBroadcastCsv(`phone\n+15551230000`);
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '15551230000' }],
    });
  });

  it('drops the extra columns the importer understands', () => {
    const result = parseBroadcastCsv(
      `phone,name,email,company,tags
+15551230000,Ada,ada@example.com,Analytical Engines,"VIP, Lead"`
    );
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '15551230000', name: 'Ada' }],
    });
  });

  it('tolerates any column order', () => {
    const result = parseBroadcastCsv(`name,phone\nAda,+15551230000`);
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '15551230000', name: 'Ada' }],
    });
  });

  // The downstream upsert inserts against UNIQUE (account_id,
  // phone_normalized) (migration 022). If two spellings of one number
  // both reached it, the whole broadcast would die on a 23505 — so
  // collapsing them here is the fix, not a nicety.
  it('collapses differently-formatted spellings of the same number', () => {
    const result = parseBroadcastCsv(
      `phone,name
+1 (555) 123-0000,Ada
15551230000,Ada Again`
    );

    expect(result).toEqual({
      ok: true,
      duplicates: 1,
      invalid: 0,
      contacts: [{ phone: '15551230000', name: 'Ada' }],
    });
  });

  it('reports a missing phone header distinctly from an empty file', () => {
    expect(parseBroadcastCsv(`name,email\nAda,ada@example.com`)).toEqual({
      ok: false,
      error: 'missing_phone_column',
    });
    // No header at all reads the same way — there is no `phone` column.
    expect(parseBroadcastCsv('')).toEqual({
      ok: false,
      error: 'missing_phone_column',
    });
  });

  it('reports no_valid_rows when the header is good but no number is', () => {
    expect(parseBroadcastCsv(`phone,name\n,Ada\n"",Grace`)).toEqual({
      ok: false,
      error: 'no_valid_rows',
    });
  });

  it('handles CRLF line endings and a trailing newline', () => {
    const result = parseBroadcastCsv(
      'phone,name\r\n+15551230000,Ada\r\n+15559990000,Grace\r\n'
    );
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [
        { phone: '15551230000', name: 'Ada' },
        { phone: '15559990000', name: 'Grace' },
      ],
    });
  });

  // A metade aditiva do #586 (P9), com a NOSSA régua: o número brasileiro
  // sem DDI ganha o 55 — e SAI normalizado, que é o que acha a ficha do
  // cliente no disparo (antes "81988745316" criava uma ficha nova, e ela
  // saía para +81). O que não serve é CONTADO, nunca chamado de duplicata.
  it('normalizes a Brazilian number typed without the country code', () => {
    expect(parseBroadcastCsv(`phone,name\n(81) 98874-5316,Ana`)).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 0,
      contacts: [{ phone: '5581988745316', name: 'Ana' }],
    });
  });

  it('the same client with and without the country code is ONE row', () => {
    const result = parseBroadcastCsv(
      `phone,name\n81988745316,Ana\n+55 81 98874-5316,Ana de novo`
    );
    expect(result).toEqual({
      ok: true,
      duplicates: 1,
      invalid: 0,
      contacts: [{ phone: '5581988745316', name: 'Ana' }],
    });
  });

  it('counts blank and unusable numbers as INVALID, not as duplicates', () => {
    const result = parseBroadcastCsv(
      `phone,name\n+15551230000,Ada\n,Sem telefone\n98874-5316,Sem DDD\n81 ramal 22,Com letra`
    );
    expect(result).toEqual({
      ok: true,
      duplicates: 0,
      invalid: 3,
      contacts: [{ phone: '15551230000', name: 'Ada' }],
    });
  });
});

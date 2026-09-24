import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';

// A mock query builder that records every call for inspection. It answers
// the four lookups this module makes:
//   message_templates: .update().eq().select()  → selectResult (then
//                      retrySelectResult for the 2nd UPDATE, if given)
//                      .select().eq()×4.limit() → { data: existentes }
//                      .insert()                → { error: insertError }
//   cb_channels:       .select().eq('kind').eq('waba_id') → { data: canais }
//   accounts:          .select().eq('id').maybeSingle()   → the owner
type SelectResult = {
  data: { id: string }[] | null;
  error: { message: string; code?: string } | null;
};

function makeSupabaseStub(
  selectResult: SelectResult = { data: [{ id: 'row-1' }], error: null },
  opts: {
    canais?: { id: string; account_id: string }[];
    existentes?: { id: string }[];
    /** O dono da conta; `null` = conta sem dono resolvido. */
    dono?: string | null;
    insertError?: { message: string; code?: string } | null;
    retrySelectResult?: SelectResult;
  } = {},
) {
  const calls: {
    table: string;
    op?: 'select' | 'update' | 'insert';
    update?: Record<string, unknown>;
    /** The LAST `.eq()` — kept for the single-filter assertions. */
    filter?: { column: string; value: unknown };
    filters: [string, unknown][];
    insert?: Record<string, unknown>;
    select?: string;
  }[] = [];
  let updateCount = 0;

  const stub = {
    from(table: string) {
      const entry: (typeof calls)[number] = { table, filters: [] };
      calls.push(entry);
      let resultadoDoUpdate: SelectResult = selectResult;
      const resolver = () => {
        if (table === 'cb_channels') return { data: opts.canais ?? [], error: null };
        if (table === 'accounts') {
          const dono = opts.dono === undefined ? 'dono-1' : opts.dono;
          return { data: dono ? { owner_user_id: dono } : null, error: null };
        }
        if (entry.op === 'update') return resultadoDoUpdate;
        return { data: opts.existentes ?? [], error: null };
      };
      const q = {
        select(columns?: string) {
          if (!entry.op) {
            entry.op = 'select';
            entry.select = columns;
          }
          return q;
        },
        update(payload: Record<string, unknown>) {
          entry.op = 'update';
          entry.update = payload;
          updateCount++;
          resultadoDoUpdate =
            updateCount > 1 && opts.retrySelectResult ? opts.retrySelectResult : selectResult;
          return q;
        },
        insert(row: Record<string, unknown>) {
          entry.op = 'insert';
          entry.insert = row;
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        eq(column: string, value: unknown) {
          entry.filter = { column, value };
          entry.filters.push([column, value]);
          return q;
        },
        limit() {
          return q;
        },
        maybeSingle() {
          return Promise.resolve(resolver());
        },
        then(ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) {
          return Promise.resolve(resolver()).then(ok, falha);
        },
      };
      return q;
    },
  };

  return { stub: stub as unknown as SupabaseClient, calls };
}

describe('isTemplateWebhookField', () => {
  it('recognises the three template fields', () => {
    expect(isTemplateWebhookField('message_template_status_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_quality_update')).toBe(true);
    expect(isTemplateWebhookField('message_template_components_update')).toBe(
      true,
    );
  });
  it('rejects messaging fields', () => {
    expect(isTemplateWebhookField('messages')).toBe(false);
    expect(isTemplateWebhookField('message_status')).toBe(false);
  });
});

describe('handleTemplateWebhookChange — status update', () => {
  let supabaseCalls: ReturnType<typeof makeSupabaseStub>['calls'];

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('flips status to APPROVED and clears any rejection_reason', async () => {
    const { stub, calls } = makeSupabaseStub();
    supabaseCalls = calls;
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: 12345,
          message_template_name: 'order_confirmation',
          message_template_language: 'en_US',
        },
      },
      stub,
    );
    expect(supabaseCalls).toHaveLength(1);
    expect(supabaseCalls[0].table).toBe('message_templates');
    expect(supabaseCalls[0].filter).toEqual({
      column: 'meta_template_id',
      value: '12345', // coerced to string so the .eq matches the TEXT column
    });
    expect(supabaseCalls[0].update).toEqual({
      status: 'APPROVED',
      rejection_reason: null,
      submission_error: null,
    });
  });

  it('persists the reason field on REJECTED', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'REJECTED',
          message_template_id: 'TMPL_99',
          reason: 'Template uses non-compliant language.',
        },
      },
      stub,
    );
    expect(calls[0].update?.status).toBe('REJECTED');
    expect(calls[0].update?.rejection_reason).toBe(
      'Template uses non-compliant language.',
    );
  });

  it('falls back to a generic reason when REJECTED has no `reason`', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'REJECTED', message_template_id: '7' },
      },
      stub,
    );
    expect(calls[0].update?.rejection_reason).toBe('Rejected by Meta');
  });

  it('normalises PENDING_REVIEW → PENDING (via shared normalizeStatus)', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'PENDING_REVIEW', message_template_id: '1' },
      },
      stub,
    );
    expect(calls[0].update?.status).toBe('PENDING');
  });

  it('logs and exits when meta_template_id is missing (no UPDATE issued)', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: { event: 'APPROVED' },
      },
      stub,
    );
    expect(calls).toHaveLength(0);
  });

  it('logs a warning when the row is unknown locally and no WABA id was passed', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null });
    await handleTemplateWebhookChange(
      {
        field: 'message_template_status_update',
        value: {
          event: 'APPROVED',
          message_template_id: 'NEVER_SEEN',
          message_template_name: 'mystery',
        },
      },
      stub,
    );
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).toContain('no WABA id');
    // Without a WABA id there is nothing to resolve the account with —
    // no config lookup, no insert.
    expect(calls).toHaveLength(1);
    expect(calls[0].insert).toBeUndefined();
  });
});

describe('handleTemplateWebhookChange — unknown template stub (#534, porte da Fase 6b)', () => {
  // A conexão oficial desta WABA. O original resolvia a conta por
  // `whatsapp_config` — o espelho de um número, que nesta produção não casa.
  const CANAL = { id: 'canal-meta-1', account_id: 'acc-1' };

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const statusDe = (over: Record<string, unknown> = {}, wabaId: string | undefined = 'WABA-1') => ({
    field: 'message_template_status_update',
    value: {
      event: 'APPROVED',
      message_template_id: 555,
      message_template_name: 'created_in_meta',
      message_template_language: 'de',
      ...over,
    },
    wabaId,
  });

  it('inserts a stub WITH the channel, owned by the account owner, for a 0-row status update', async () => {
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(statusDe(), stub);

    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual([
      'message_templates:update', // the original UPDATE (0 rows)
      'cb_channels:select', // the official connection of the WABA
      'message_templates:select', // a local row with the same name/language?
      'accounts:select', // the durable owner
      'message_templates:insert', // the stub
    ]);
    expect(calls[1].filters).toEqual([
      ['kind', 'meta'],
      ['waba_id', 'WABA-1'],
    ]);
    expect(calls[2].filters).toEqual([
      ['account_id', 'acc-1'],
      ['channel_id', 'canal-meta-1'],
      ['name', 'created_in_meta'],
      ['language', 'de'],
    ]);
    expect(calls[4].insert).toEqual({
      account_id: 'acc-1',
      user_id: 'dono-1',
      channel_id: 'canal-meta-1',
      meta_template_id: '555',
      name: 'created_in_meta',
      language: 'de',
      body_text: '',
      status: 'APPROVED',
      rejection_reason: null,
      submission_error: null,
    });
  });

  it('carries the rejection reason into the stub on REJECTED and defaults language to en_US', async () => {
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(
      statusDe({
        event: 'REJECTED',
        message_template_id: '556',
        message_template_name: 'spammy',
        message_template_language: undefined,
        reason: 'INVALID_FORMAT',
      }),
      stub,
    );
    expect(calls.find((c) => c.insert)?.insert).toMatchObject({
      status: 'REJECTED',
      rejection_reason: 'INVALID_FORMAT',
      language: 'en_US',
      channel_id: 'canal-meta-1',
    });
  });

  it('warns with the WABA id and inserts nothing when no official connection matches', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [] });
    await handleTemplateWebhookChange(statusDe({ message_template_id: '557' }, 'WABA-NOBODY'), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('WABA WABA-NOBODY');
    expect(message).toContain('557');
    expect(message).toContain('no official connections');
  });

  it('refuses to guess the channel when two connections share the WABA', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { canais: [CANAL, { id: 'canal-meta-2', account_id: 'acc-1' }] },
    );
    await handleTemplateWebhookChange(statusDe({ message_template_id: '558' }), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain('2 official connections');
  });

  it('⚠️ does not duplicate a local row of the same name/language in the channel, whoever wrote it', async () => {
    // O índice único leva o `user_id` (903): o stub do dono passaria por ele
    // ao lado de um modelo criado por outro admin.
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { canais: [CANAL], existentes: [{ id: 'row-de-outro-admin' }] },
    );
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain('not linked to this meta_template_id');
  });

  it('⚠️ never writes a member as the author: no owner resolved = no stub', async () => {
    const erro = vi.spyOn(console, 'error');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL], dono: null });
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(erro.mock.calls[0][0])).toContain('account owner lookup failed');
  });

  it('inserts a stub with quality_score (and no status) for a 0-row quality update', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '559',
          message_template_name: 'created_in_meta',
          message_template_language: 'en_US',
          previous_quality_score: 'UNKNOWN',
          new_quality_score: 'RED',
        },
        wabaId: 'WABA-1',
      },
      stub,
    );
    expect(calls[0].update).toEqual({ quality_score: 'RED' });
    const insert = calls.find((c) => c.insert)?.insert;
    expect(insert).toEqual({
      account_id: 'acc-1',
      user_id: 'dono-1',
      channel_id: 'canal-meta-1',
      meta_template_id: '559',
      name: 'created_in_meta',
      language: 'en_US',
      body_text: '',
      quality_score: 'RED',
    });
    // `status` is deliberately absent — the column default applies.
    expect(insert).not.toHaveProperty('status');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (with the WABA id) on a 0-row quality update when the connection cannot be resolved', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [] });
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: { message_template_id: '560', message_template_name: 'orphan', new_quality_score: 'GREEN' },
        wabaId: 'WABA-NOBODY',
      },
      stub,
    );
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain('quality update');
    expect(String(warn.mock.calls[0][0])).toContain('WABA WABA-NOBODY');
  });

  it('retries the update once when the stub insert hits a unique violation', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      {
        canais: [CANAL],
        insertError: { message: 'duplicate key', code: '23505' },
        retrySelectResult: { data: [{ id: 'row-raced' }], error: null },
      },
    );
    await handleTemplateWebhookChange(
      statusDe({ event: 'PAUSED', message_template_id: '561', message_template_name: 'raced' }),
      stub,
    );
    const updates = calls.filter((c) => c.update);
    expect(updates).toHaveLength(2);
    expect(updates[1].update).toEqual(updates[0].update);
    expect(updates[1].filter).toEqual({ column: 'meta_template_id', value: '561' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not create a stub when the event has no template name', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(
      { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: '562' }, wabaId: 'WABA-1' },
      stub,
    );
    expect(calls).toHaveLength(1);
    expect(String(warn.mock.calls[0][0])).toContain('no message_template_name');
  });
});

describe('handleTemplateWebhookChange — quality update', () => {
  it('sets quality_score from new_quality_score', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '99',
          previous_quality_score: 'GREEN',
          new_quality_score: 'YELLOW',
        },
      },
      stub,
    );
    expect(calls[0].update).toEqual({ quality_score: 'YELLOW' });
    expect(calls[0].filter).toEqual({
      column: 'meta_template_id',
      value: '99',
    });
  });

  it('stores null for unrecognised quality scores', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_quality_update',
        value: {
          message_template_id: '99',
          new_quality_score: 'PURPLE', // not a real Meta value
        },
      },
      stub,
    );
    expect(calls[0].update).toEqual({ quality_score: null });
  });
});

describe('handleTemplateWebhookChange — components update', () => {
  it('is an info-log no-op (does not write to DB)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      {
        field: 'message_template_components_update',
        value: {
          message_template_id: '5',
          message_template_name: 'x',
        },
      },
      stub,
    );
    expect(calls).toHaveLength(0);
    expect(info).toHaveBeenCalled();
  });
});

describe('handleTemplateWebhookChange — unknown field', () => {
  it('is a defensive no-op', async () => {
    const { stub, calls } = makeSupabaseStub();
    await handleTemplateWebhookChange(
      // Pretend Meta added a new template_* field we don't know about.
      // The route handler pre-filters via isTemplateWebhookField, but
      // the dispatch should still be safe if the filter is bypassed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { field: 'message_template_future_field' as any, value: {} },
      stub,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('a rota do webhook liga o stub (Fase 6b)', () => {
  it('passa a WABA do envelope (`entry.id`) e o stub lê cb_channels, nunca whatsapp_config', () => {
    const semComentarios = (rel: string) =>
      fs
        .readFileSync(path.join(__dirname, '..', '..', rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
    // Sem o `wabaId`, todo modelo criado direto no painel da Meta só vira
    // log — o stub fica inerte, que era o estado do #259.
    expect(semComentarios('app/api/whatsapp/webhook/route.ts')).toMatch(
      /handleTemplateWebhookChange\(\s*\{[^}]*wabaId:\s*entry\.id/,
    );
    const modulo = semComentarios('lib/whatsapp/template-webhook.ts');
    expect(modulo).toContain(".from('cb_channels')");
    expect(modulo).not.toContain("from('whatsapp_config')");
  });
});

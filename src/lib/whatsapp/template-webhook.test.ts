import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageTemplate } from '@/types';

// O token da conexão é decifrado antes de ler o modelo na Meta.
vi.mock('./encryption', () => ({ decrypt: (s: string) => `claro:${s}` }));

import {
  handleTemplateWebhookChange,
  isTemplateWebhookField,
} from './template-webhook';
import { buildSendComponents } from './template-send-builder';
import { isMessageTemplate } from './template-row-guard';

// A mock query builder that records every call for inspection. It answers
// the four lookups this module makes:
//   message_templates: .update().eq().select()  → selectResult (then
//                      retrySelectResult for the 2nd UPDATE, if given)
//                      .select().eq().or().eq()×2.limit() → { data: existentes }
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
    canais?: { id: string; account_id: string; access_token?: string | null }[];
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
        or(filtro: string) {
          entry.filters.push(['or', filtro]);
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
  const CANAL = { id: 'canal-meta-1', account_id: 'acc-1', access_token: 'tok-cifrado' };

  /** O modelo como a Meta o devolve em `GET /{id}` — com corpo e variáveis. */
  const modeloDaMeta = (over: Record<string, unknown> = {}) => ({
    id: '555',
    name: 'created_in_meta',
    language: 'de',
    status: 'APPROVED',
    category: 'UTILITY',
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['h:1'] } },
      {
        type: 'BODY',
        text: 'Olá {{1}}, o boleto de {{2}} vence hoje.',
        example: { body_text: [['Ana', 'R$ 10']] },
      },
    ],
    ...over,
  });

  let fetchDaMeta: ReturnType<typeof vi.fn>;
  const respondeMeta = (corpo: unknown, status = 200) =>
    fetchDaMeta.mockResolvedValue(
      new Response(JSON.stringify(corpo), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchDaMeta = vi.fn();
    vi.stubGlobal('fetch', fetchDaMeta);
    respondeMeta(modeloDaMeta());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('reads the template from Meta and inserts it COMPLETE, with the channel and the account owner', async () => {
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

    // A leitura: pelo id, com o token DECIFRADO da conexão, no cabeçalho.
    expect(fetchDaMeta).toHaveBeenCalledOnce();
    const [url, init] = fetchDaMeta.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://graph.facebook.com/v21.0/555?fields=id,name,language,status,category,components,quality_score',
    );
    expect(init.headers).toEqual({ Authorization: 'Bearer claro:tok-cifrado' });

    expect(calls[4].insert).toEqual({
      account_id: 'acc-1',
      user_id: 'dono-1',
      channel_id: 'canal-meta-1',
      name: 'created_in_meta',
      category: 'Utility',
      language: 'de',
      header_type: 'document',
      header_content: null,
      header_handle: 'h:1',
      body_text: 'Olá {{1}}, o boleto de {{2}} vence hoje.',
      footer_text: null,
      buttons: null,
      sample_values: { body: ['Ana', 'R$ 10'] },
      status: 'APPROVED',
      meta_template_id: '555',
      quality_score: null,
      rejection_reason: null,
    });
  });

  it('⚠️ the stub is a template the send path can use: the caller parameters are NOT dropped', async () => {
    // O defeito que a revisão mediu: com `body_text: ''` o stub virava o
    // modelo do envio, `buildSendComponents` contava zero variáveis e mandava
    // `parameters: []` — a Meta recusava o que funcionava sem linha local.
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(statusDe(), stub);
    const linha = { id: 'row-stub', ...calls.find((c) => c.insert)?.insert } as unknown;
    expect(isMessageTemplate(linha)).toBe(true);
    const componentes = buildSendComponents(linha as MessageTemplate, {
      body: ['Ana', 'R$ 10'],
      headerMediaUrl: 'https://x.test/boleto.pdf',
    });
    expect(componentes.find((c) => c.type === 'body')).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Ana' },
        { type: 'text', text: 'R$ 10' },
      ],
    });
  });

  it('carries the event rejection reason when Meta says REJECTED, and takes the language from Meta', async () => {
    respondeMeta(modeloDaMeta({ id: '556', name: 'spammy', language: 'pt_BR', status: 'REJECTED' }));
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
      language: 'pt_BR',
      channel_id: 'canal-meta-1',
    });
  });

  it('⚠️ reading from Meta fails = no stub, and the log never carries the Meta message (it can echo the token)', async () => {
    const warn = vi.spyOn(console, 'warn');
    respondeMeta({ error: { code: 190, message: 'Malformed access token EAAB-segredo' } }, 400);
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    const mensagem = String(warn.mock.calls[0][0]);
    expect(mensagem).toContain('HTTP 400 (code 190)');
    expect(mensagem).not.toContain('EAAB');
  });

  it('a network failure reading from Meta creates nothing either', async () => {
    fetchDaMeta.mockRejectedValue(new TypeError('fetch failed'));
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
  });

  it('refuses the answer when Meta returns another template id', async () => {
    respondeMeta(modeloDaMeta({ id: '999' }));
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
  });

  it('a connection without an access token does not call Meta', async () => {
    const erro = vi.spyOn(console, 'error');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { canais: [{ ...CANAL, access_token: null }] },
    );
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(fetchDaMeta).not.toHaveBeenCalled();
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(erro.mock.calls[0][0])).toContain('no usable access token');
  });

  it.each(['PENDING_DELETION', 'DELETED', 'ARCHIVED'])(
    '⚠️ %s for an unknown template does NOT resurrect it as a stub',
    async (evento) => {
      // A rota de exclusão apaga na Meta e em seguida a linha local; o aviso
      // que a Meta manda depois não pode trazer o modelo de volta.
      const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
      await handleTemplateWebhookChange(statusDe({ event: evento }), stub);
      expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['message_templates:update']);
      expect(fetchDaMeta).not.toHaveBeenCalled();
    },
  );

  it('warns with the WABA id and inserts nothing when no official connection matches', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [] });
    await handleTemplateWebhookChange(statusDe({ message_template_id: '557' }, 'WABA-NOBODY'), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(fetchDaMeta).not.toHaveBeenCalled();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('WABA WABA-NOBODY');
    expect(message).toContain('557');
    expect(message).toContain('no official connections');
  });

  it('refuses to guess the channel when two connections share the WABA', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { canais: [CANAL, { id: 'canal-meta-2', account_id: 'acc-1', access_token: 'x' }] },
    );
    await handleTemplateWebhookChange(statusDe({ message_template_id: '558' }), stub);
    expect(calls.some((c) => c.insert)).toBe(false);
    expect(String(warn.mock.calls[0][0])).toContain('2 official connections');
  });

  it('⚠️ looks for a same-name row in the channel OR without a channel — the sync rule', async () => {
    // A sincronização adota a linha sem canal; o stub nascendo ao lado dela
    // fazia o `maybeSingle` da sincronização falhar para aquele modelo em
    // toda sincronização (revisão da Fase 6). O índice único leva o `user_id`
    // (903), então nem o autor diferente segura a duplicata.
    const warn = vi.spyOn(console, 'warn');
    const { stub, calls } = makeSupabaseStub(
      { data: [], error: null },
      { canais: [CANAL], existentes: [{ id: 'row-global-antiga' }] },
    );
    await handleTemplateWebhookChange(statusDe(), stub);
    expect(calls[2].filters).toEqual([
      ['account_id', 'acc-1'],
      ['or', 'channel_id.eq.canal-meta-1,channel_id.is.null'],
      ['name', 'created_in_meta'],
      ['language', 'de'],
    ]);
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

  it('a 0-row quality update creates the stub with the status Meta reports (not DRAFT)', async () => {
    const warn = vi.spyOn(console, 'warn');
    respondeMeta(modeloDaMeta({ id: '559', status: 'PAUSED', quality_score: { score: 'RED' } }));
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
    expect(calls.find((c) => c.insert)?.insert).toMatchObject({
      meta_template_id: '559',
      status: 'PAUSED',
      quality_score: 'RED',
      body_text: 'Olá {{1}}, o boleto de {{2}} vence hoje.',
      rejection_reason: null,
    });
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
    respondeMeta(modeloDaMeta({ id: '561', name: 'raced', status: 'PAUSED' }));
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

  it('an event without the template name still creates it — the name comes from Meta', async () => {
    const { stub, calls } = makeSupabaseStub({ data: [], error: null }, { canais: [CANAL] });
    await handleTemplateWebhookChange(
      { field: 'message_template_status_update', value: { event: 'APPROVED', message_template_id: '555' }, wabaId: 'WABA-1' },
      stub,
    );
    expect(calls.find((c) => c.insert)?.insert).toMatchObject({ name: 'created_in_meta', language: 'de' });
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
    const rota = semComentarios('app/api/whatsapp/webhook/route.ts');
    // UMA chamada, e com a WABA do próprio envelope (`entry.id`, nada depois).
    expect(rota.match(/handleTemplateWebhookChange\(/g)).toHaveLength(1);
    expect(rota).toMatch(/handleTemplateWebhookChange\(\s*\{[^}]*wabaId:\s*entry\.id\s*\}/);
    const modulo = semComentarios('lib/whatsapp/template-webhook.ts');
    expect(modulo).toMatch(/\.from\(\s*['"]cb_channels['"]\s*\)/);
    expect(modulo).not.toMatch(/from\(\s*['"`]whatsapp_config['"`]/);
  });
});

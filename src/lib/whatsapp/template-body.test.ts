import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  renderTemplateBody,
  resolveTemplateRow,
  templateBodyParams,
  templateContentText,
} from './template-body';
import type { MessageTemplate } from '@/types';

function row(over: Partial<MessageTemplate>): MessageTemplate {
  return {
    id: 'tpl-1',
    user_id: 'u-1',
    name: 'order_update',
    category: 'Utility',
    language: 'en_US',
    body_text: 'Your order {{1}} ships on {{2}}',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  } as MessageTemplate;
}

/**
 * Minimal `from().select().eq().eq()` thenable — the same surface
 * resolveTemplateRow uses. Records the filters so a test can assert
 * the lookup is account-scoped.
 */
function dbReturning(
  rows: unknown[],
  filters: Record<string, unknown> = {}
): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filters[col] = val;
      return builder;
    },
    then: (resolve: (r: { data: unknown[] }) => unknown) =>
      resolve({ data: rows }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe('renderTemplateBody', () => {
  it('substitutes positional placeholders', () => {
    expect(
      renderTemplateBody('Your order {{1}} ships on {{2}}', ['A123', 'Friday'])
    ).toBe('Your order A123 ships on Friday');
  });

  it('leaves a placeholder visible when the param is missing', () => {
    expect(renderTemplateBody('Hi {{1}}, code {{2}}', ['Sam'])).toBe(
      'Hi Sam, code {{2}}'
    );
  });

  it('handles a body with no placeholders and repeated indexes', () => {
    expect(renderTemplateBody('No variables here', ['x'])).toBe(
      'No variables here'
    );
    expect(renderTemplateBody('{{1}} and {{1}}', ['twice'])).toBe(
      'twice and twice'
    );
  });
});

describe('templateBodyParams', () => {
  it('prefers structured body values over the legacy array', () => {
    expect(templateBodyParams(['legacy'], { body: ['structured'] })).toEqual([
      'structured',
    ]);
  });

  it('falls back to the legacy array when structured body is absent', () => {
    expect(templateBodyParams(['a', 'b'], { headerText: 'x' })).toEqual([
      'a',
      'b',
    ]);
    expect(templateBodyParams(['a'], undefined)).toEqual(['a']);
  });

  it('returns an empty array for junk input', () => {
    expect(templateBodyParams(null, null)).toEqual([]);
    expect(templateBodyParams(undefined, { body: 'not-an-array' })).toEqual([]);
  });

  it('drops non-string entries from the structured body', () => {
    expect(templateBodyParams([], { body: ['ok', 7, null] })).toEqual(['ok']);
  });
});

describe('resolveTemplateRow', () => {
  it('scopes the lookup to the account and template name', async () => {
    const filters: Record<string, unknown> = {};
    await resolveTemplateRow(
      dbReturning([row({})], filters),
      'acct-1',
      'order_update',
      'en_US'
    );
    expect(filters).toEqual({ account_id: 'acct-1', name: 'order_update' });
  });

  it("matches a synced 'en' row when the caller asks for 'en_US' (#483)", async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([row({ language: 'en' })]),
      'acct-1',
      'order_update',
      'en_US'
    );
    expect(resolved.row?.language).toBe('en');
    // Caller pinned a language — that is what Meta is sent.
    expect(resolved.language).toBe('en_US');
  });

  it("resolves a bare 'en' row when the caller omits the language, and sends 'en'", async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([row({ language: 'en' })]),
      'acct-1',
      'order_update',
      null
    );
    expect(resolved.row?.language).toBe('en');
    // The old code pinned 'en_US' here, which Meta rejects as a
    // missing translation.
    expect(resolved.language).toBe('en');
  });

  it('prefers an exact language match over a base-language sibling', async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([
        row({ id: 'a', language: 'en' }),
        row({ id: 'b', language: 'en_GB' }),
      ]),
      'acct-1',
      'order_update',
      'en_GB'
    );
    expect(resolved.row?.id).toBe('b');
  });

  it('prefers en_US then en when no language is requested', async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([
        row({ id: 'es', language: 'es' }),
        row({ id: 'us', language: 'en_US' }),
        row({ id: 'en', language: 'en' }),
      ]),
      'acct-1',
      'order_update'
    );
    expect(resolved.row?.id).toBe('us');
  });

  it('returns no row when the account has none, keeping the requested language', async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([]),
      'acct-1',
      'missing',
      'fr'
    );
    expect(resolved).toEqual({ row: null, malformed: false, language: 'fr' });
  });

  it('reports a row that matched by name but fails the shape guard', async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([{ id: 'tpl-1', language: 'en_US' /* no body_text */ }]),
      'acct-1',
      'order_update',
      'en_US'
    );
    expect(resolved.malformed).toBe(true);
    expect(resolved.row).toBeNull();
  });

  it('sends the caller-pinned language even when no local row matches it', async () => {
    const resolved = await resolveTemplateRow(
      dbReturning([row({ language: 'es' })]),
      'acct-1',
      'order_update',
      'de'
    );
    expect(resolved.row).toBeNull();
    expect(resolved.language).toBe('de');
  });
});

describe('templateContentText', () => {
  it('renders the substituted body from the local row', () => {
    expect(templateContentText(row({}), ['A123', 'Friday'])).toBe(
      'Your order A123 ships on Friday'
    );
  });

  it("prefers the caller's pre-rendered text (the dashboard composer)", () => {
    expect(
      templateContentText(row({}), ['A123', 'Friday'], 'composer rendered')
    ).toBe('composer rendered');
  });

  it('is null when there is no local row to render from', () => {
    expect(templateContentText(null, ['A123'])).toBeNull();
  });
});

// ============================================================
// REGRESSÃO DO MERGE (upstream 2026-08-26) — recorte por canal.
//
// `resolveTemplateRow` chegou do upstream conhecendo só `(account_id, name)`.
// O catálogo da Meta é POR WABA, então sem recorte de canal, numa conta com
// dois números, o atendente vê o preview de um modelo e o cliente recebe o
// texto de outro — ou nada, com a Meta devolvendo "template does not exist".
//
// Cinco call sites dependem deste comportamento (send-message, meta-send,
// broadcast-core, broadcast-resume e a rota de broadcast). Estes casos
// existem para que um merge futuro que reintroduza a versão do upstream
// falhe aqui, em vez de falhar em produção meses depois.
// ============================================================
describe('resolveTemplateRow — recorte por canal (multi-canal, 903)', () => {
  const doCanal = row({
    id: 'tpl-canal',
    body_text: 'Do canal',
    channel_id: 'canal-1',
  } as Partial<MessageTemplate>);
  const global = row({
    id: 'tpl-global',
    body_text: 'Global',
    channel_id: null,
  } as Partial<MessageTemplate>);
  const deOutro = row({
    id: 'tpl-outro',
    body_text: 'De outro numero',
    channel_id: 'canal-2',
  } as Partial<MessageTemplate>);

  it('prefere o modelo do canal ao global de mesmo nome', async () => {
    const r = await resolveTemplateRow(
      dbReturning([global, doCanal]),
      'acct-1',
      'order_update',
      'en_US',
      'canal-1'
    );
    expect(r.row?.id).toBe('tpl-canal');
  });

  it('cai para o global quando o canal não tem modelo próprio', async () => {
    // Modelo anterior à 903 (channel_id NULL) continua valendo como reserva —
    // o oposto esconderia o catálogo inteiro de quem já tinha campanhas.
    const r = await resolveTemplateRow(
      dbReturning([global]),
      'acct-1',
      'order_update',
      'en_US',
      'canal-1'
    );
    expect(r.row?.id).toBe('tpl-global');
  });

  it('NUNCA usa o modelo de outro canal', async () => {
    // O caso que motiva tudo: com o modelo do canal-2 disponível e nada para
    // o canal-1, a resposta certa é "não tenho", não "usa o do vizinho".
    const r = await resolveTemplateRow(
      dbReturning([deOutro]),
      'acct-1',
      'order_update',
      'en_US',
      'canal-1'
    );
    expect(r.row).toBeNull();
  });

  it('sem canal informado, enxerga tudo — o comportamento do upstream', async () => {
    // Conta de um número só, e todo caminho anterior à 903. Se este caso
    // quebrar, a regressão é no sentido oposto: passamos a esconder modelo
    // de quem nunca teve canal.
    const r = await resolveTemplateRow(
      dbReturning([global]),
      'acct-1',
      'order_update',
      'en_US'
    );
    expect(r.row?.id).toBe('tpl-global');
  });

  it('o recorte de canal não atropela o fallback en / en_US do upstream', async () => {
    // As duas correções coexistem: primeiro estreita por canal, depois
    // resolve idioma dentro do que sobrou.
    const bare = row({
      id: 'tpl-canal-en',
      language: 'en',
      channel_id: 'canal-1',
    } as Partial<MessageTemplate>);
    const r = await resolveTemplateRow(
      dbReturning([bare, deOutro]),
      'acct-1',
      'order_update',
      'en_US',
      'canal-1'
    );
    expect(r.row?.id).toBe('tpl-canal-en');
    expect(r.language).toBe('en_US');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { conteudoDoModeloDaMeta, lerModeloNaMeta, type MetaTemplate } from './modelo-da-meta';

// A conversão saiu da rota de sincronização (que não tinha teste) para servir
// também ao stub do webhook. Estes casos fixam o que ela sempre fez.
describe('conteudoDoModeloDaMeta — a mesma conversão da sincronização e do stub', () => {
  const base: MetaTemplate = {
    id: '901',
    name: 'boleto',
    language: 'pt_BR',
    status: 'APPROVED',
    category: 'UTILITY',
  };

  it('converte cabeçalho de texto, corpo, rodapé, botões e exemplos', () => {
    const c = conteudoDoModeloDaMeta({
      ...base,
      quality_score: { score: 'green' },
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Oi {{1}}', example: { header_text: ['Ana'] } },
        { type: 'BODY', text: 'Vence {{1}}', example: { body_text: [['amanhã'], ['hoje']] } },
        { type: 'FOOTER', text: 'CB' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Ok' },
            { type: 'URL', text: 'Pagar', url: 'https://x.test/{{1}}', example: ['abc'] },
            { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511999990000' },
            { type: 'COPY_CODE', text: 'Copiar', example: 'PIX123' },
            { type: 'OTP', text: 'ignorado' },
          ],
        },
      ],
    });
    expect(c).toEqual({
      name: 'boleto',
      category: 'Utility',
      language: 'pt_BR',
      header_type: 'text',
      header_content: 'Oi {{1}}',
      header_handle: null,
      body_text: 'Vence {{1}}',
      footer_text: 'CB',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Ok' },
        { type: 'URL', text: 'Pagar', url: 'https://x.test/{{1}}', example: 'abc' },
        { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '+5511999990000' },
        { type: 'COPY_CODE', text: 'Copiar', example: 'PIX123' },
      ],
      sample_values: { body: ['amanhã'], header: ['Ana'] },
      status: 'APPROVED',
      meta_template_id: '901',
      quality_score: 'GREEN',
    });
  });

  it('cabeçalho de mídia leva o handle; formato desconhecido não vira cabeçalho', () => {
    const video = conteudoDoModeloDaMeta({
      ...base,
      components: [
        { type: 'HEADER', format: 'VIDEO', example: { header_handle: ['h:9'] } },
        { type: 'BODY', text: 'x' },
      ],
    });
    expect(video).toMatchObject({ header_type: 'video', header_handle: 'h:9' });
    const local = conteudoDoModeloDaMeta({
      ...base,
      components: [{ type: 'HEADER', format: 'LOCATION' }, { type: 'BODY', text: 'x' }],
    });
    expect(local.header_type).toBeNull();
  });

  it('categoria, situação e qualidade desconhecidas caem nos padrões de sempre', () => {
    const c = conteudoDoModeloDaMeta({
      ...base,
      category: 'algo_novo',
      status: 'PENDING_REVIEW',
      quality_score: 'UNKNOWN',
    });
    expect(c).toMatchObject({
      category: 'Marketing',
      status: 'PENDING',
      quality_score: null,
      body_text: '',
      buttons: null,
      sample_values: null,
    });
    expect(conteudoDoModeloDaMeta({ ...base, category: 'AUTHENTICATION' }).category).toBe(
      'Authentication',
    );
  });
});

describe('lerModeloNaMeta', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lê pelo id, com o token no cabeçalho (nunca na URL) e prazo', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(base()), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const r = await lerModeloNaMeta('901', 'tok-claro');
    expect(r).toEqual({ ok: true, modelo: base() });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.startsWith('https://graph.facebook.com/v21.0/901?fields=')).toBe(true);
    expect(url).not.toContain('tok-claro');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-claro' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('a recusa da Meta vira status + código, sem a mensagem (que ecoa o token)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 100, message: 'token EAAB-segredo' } }), {
            status: 400,
          }),
      ),
    );
    const r = await lerModeloNaMeta('901', 'x');
    expect(r).toEqual({ ok: false, falha: 'HTTP 400 (code 100)' });
  });

  it('corpo sem a forma de um modelo não passa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: '901' }), { status: 200 })));
    expect(await lerModeloNaMeta('901', 'x')).toEqual({ ok: false, falha: 'unexpected shape' });
  });

  it('tempo esgotado e rede são falhas, não exceções', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timeout', 'TimeoutError');
      }),
    );
    expect(await lerModeloNaMeta('901', 'x')).toEqual({ ok: false, falha: 'timeout' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await lerModeloNaMeta('901', 'x')).toEqual({ ok: false, falha: 'network' });
  });

  function base(): MetaTemplate {
    return { id: '901', name: 'boleto', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY' };
  }
});

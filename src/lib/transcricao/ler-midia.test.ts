import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ia-chaves/repo', () => ({ lerChave: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}) }))

import type { AiProvider } from '@/lib/ai/types'
import { logAiUsage } from '@/lib/ai/usage'
import { lerChave } from '@/lib/ia-chaves/repo'

import { MARCA_DE_CORTE } from './leitores'
import { classificarMidia, lerMidia, RECUSA } from './ler-midia'

/** O `fetch` falso, com o `init` tipado nas chamadas registradas. */
type FetchFalso = (url: string, init?: RequestInit) => Promise<unknown>

// ============================================================
// A leitura de imagem e PDF (`ler-midia.ts`): a mecânica da transcrição
// (cadeado, idempotência, `recusada` sem gravar por configuração) com o
// provedor escolhido pela CHAVE. O banco é o stub de fila de
// `transcrever.test.ts`: cada `from()` consome UMA resposta, na ordem real das
// consultas — uma consulta a mais ou a menos quebra o teste.
// ============================================================

interface Chamada {
  table: string
  op: 'select' | 'update'
  payload?: Record<string, unknown>
  filtros: string[]
}
type Resposta = { data?: unknown; error?: { message: string } | null }

function fakeAdmin(respostas: Resposta[], chamadas: Chamada[]) {
  return {
    from(table: string) {
      const chamada: Chamada = { table, op: 'select', filtros: [] }
      chamadas.push(chamada)
      const proxima = () => Promise.resolve(respostas.shift() ?? { data: null, error: null })
      const builder: Record<string, unknown> = {
        update(payload: Record<string, unknown>) {
          chamada.op = 'update'
          chamada.payload = payload
          return builder
        },
        select() {
          chamada.filtros.push('select')
          return builder
        },
        maybeSingle: () => proxima(),
        then(res: (v: Resposta) => unknown, rej?: (e: unknown) => unknown) {
          return proxima().then(res, rej)
        },
      }
      for (const m of ['eq', 'neq', 'is', 'lt', 'or', 'in'] as const) {
        builder[m] = (...args: unknown[]) => {
          chamada.filtros.push(`${m}(${args.map(String).join('|')})`)
          return builder
        }
      }
      return builder
    },
  } as never
}

const URL_DO_BUCKET = 'https://bucket.supabase.co/storage/v1/object/public/chat-media/account-a1/1-foto.jpg'

const msgBase = {
  id: 'm1',
  conversation_id: 'c1',
  content_type: 'image',
  media_url: URL_DO_BUCKET,
  media_type: 'image/jpeg',
  media_filename: null,
  created_at: '2026-09-01T12:00:00Z', // antiga — fora da janela de download
  deleted_at: null,
  transcricao: null,
  transcricao_status: null,
  transcricao_erro: null,
  transcricao_tentativas: 0,
  conversation: { account_id: 'a1', channel_id: 'ch1' },
}
const pdfBase = {
  ...msgBase,
  content_type: 'document',
  media_type: 'application/pdf',
  media_filename: 'extrato.pdf',
  media_url: 'https://bucket.supabase.co/storage/v1/object/public/chat-media/account-a1/1-extrato.pdf',
}

/** Só estes provedores têm chave. */
function comChaves(...provedores: AiProvider[]): void {
  vi.mocked(lerChave).mockImplementation(async (_conta, p) =>
    provedores.includes(p) ? { chave: `chave-${p}`, ilegivel: false } : { chave: null, ilegivel: false },
  )
}

const RESPOSTAS: Record<string, unknown> = {
  generativelanguage: {
    candidates: [{ content: { parts: [{ text: 'Print de conversa. Cliente: "já paguei"' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20, totalTokenCount: 320 },
  },
  'api.openai.com': {
    status: 'completed',
    output: [{ type: 'message', content: [{ type: 'output_text', text: 'Extrato do Banco X, saldo R$ 1.200,00' }] }],
    usage: { input_tokens: 900, output_tokens: 30, total_tokens: 930 },
  },
  'api.anthropic.com': {
    content: [{ type: 'text', text: 'Contrato de honorários, 20%' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1500, output_tokens: 12 },
  },
}

function fakeFetch(opcoes: { bytes?: number; contentType?: string | null; contentLength?: number; provedor?: unknown; status?: number } = {}) {
  return vi.fn<FetchFalso>(async (url) => {
    const u = String(url)
    const chave = Object.keys(RESPOSTAS).find((k) => u.includes(k))
    if (chave) {
      const status = opcoes.status ?? 200
      return {
        ok: status < 400,
        status,
        json: async () => opcoes.provedor ?? RESPOSTAS[chave],
        text: async () => 'erro do provedor',
      }
    }
    return {
      ok: true,
      status: 200,
      headers: {
        get: (h: string) =>
          h === 'content-type'
            ? (opcoes.contentType === undefined ? 'image/jpeg' : opcoes.contentType)
            : h === 'content-length' && opcoes.contentLength !== undefined
              ? String(opcoes.contentLength)
              : null,
      },
      arrayBuffer: async () => new ArrayBuffer(opcoes.bytes ?? 64),
    }
  })
}

const chamadasAoProvedor = (f: ReturnType<typeof fakeFetch>) =>
  f.mock.calls.filter((c) => Object.keys(RESPOSTAS).some((k) => String(c[0]).includes(k)))

beforeEach(() => {
  vi.mocked(lerChave).mockReset()
  comChaves('gemini', 'openai', 'anthropic')
  vi.mocked(logAiUsage).mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classificarMidia — o que é, antes do download', () => {
  it('o `media_type` gravado decide', () => {
    expect(classificarMidia({ content_type: 'document', media_type: 'application/pdf' })).toEqual({ tipo: 'pdf', mime: 'application/pdf' })
    expect(
      classificarMidia({ content_type: 'document', media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
    ).toEqual({ tipo: 'outro' })
  })

  it('sem tipo: a extensão do NOME; num documento, extensão que ninguém lê já é `outro`', () => {
    expect(classificarMidia({ content_type: 'document', media_type: null, media_filename: 'peticao.PDF' })).toEqual({ tipo: 'pdf', mime: 'application/pdf' })
    expect(classificarMidia({ content_type: 'document', media_type: null, media_filename: 'planilha.xlsx' })).toEqual({ tipo: 'outro' })
  })

  it('⚠️ o ".bin" da URL do bucket não diz nada: documento sem mais nada fica para o download', () => {
    expect(
      classificarMidia({ content_type: 'document', media_type: null, media_url: 'https://x/account-1/1-file.bin' }),
    ).toEqual({ tipo: 'desconhecido' })
    expect(
      classificarMidia({ content_type: 'document', media_type: null, media_url: 'https://x/account-1/1-arquivo.pdf' }),
    ).toEqual({ tipo: 'pdf', mime: 'application/pdf' })
  })

  it('foto sem tipo nem nome é JPEG (é o que o WhatsApp entrega)', () => {
    expect(classificarMidia({ content_type: 'image', media_type: null, media_url: 'https://x/1-file.bin' })).toEqual({
      tipo: 'imagem',
      mime: 'image/jpeg',
    })
  })
})

describe('lerMidia', () => {
  it('IDEMPOTÊNCIA: leitura pronta volta sem chamar provedor nenhum', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: { ...msgBase, transcricao: 'já lida', transcricao_status: 'pronta' } }], chamadas)
    const f = fakeFetch()
    vi.stubGlobal('fetch', f)
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'pronta', texto: 'já lida' })
    expect(f).not.toHaveBeenCalled()
    expect(lerChave).not.toHaveBeenCalled()
    expect(chamadas).toHaveLength(1)
  })

  it('conta errada = "não encontrada", sem gravar', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: { ...msgBase, conversation: { account_id: 'OUTRA', channel_id: null } } }], chamadas)
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('recusada')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('IMAGEM pelo Gemini: cadeado, leitura, gravação com a cerca e custo com o provedor e o modelo usados', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { data: { id: 'm1' } }], chamadas)
    const f = fakeFetch()
    vi.stubGlobal('fetch', f)

    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'pronta', texto: 'Print de conversa. Cliente: "já paguei"' })

    const [url, init] = chamadasAoProvedor(f)[0] as [string, RequestInit]
    expect(url).toContain('/models/gemini-3.7-flash:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('chave-gemini')
    expect(String(init.body)).toContain('"mimeType":"image/jpeg"')

    const claim = chamadas.filter((c) => c.op === 'update')[0]
    expect(claim.payload?.transcricao_status).toBe('transcrevendo')
    expect(claim.filtros.join(' ')).toContain('in(content_type|image,document)')
    expect(claim.filtros.join(' ')).toContain('eq(transcricao_tentativas|0)')
    const grava = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(grava.payload).toMatchObject({ transcricao_status: 'pronta', transcricao: 'Print de conversa. Cliente: "já paguei"' })
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_status|transcrevendo)')
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_desde|')

    expect(logAiUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'transcricao', provider: 'gemini', model: 'gemini-3.7-flash', channelId: 'ch1' }),
    )
  })

  it('PDF pela OPENAI quando a conta não tem Gemini: `input_file` na Responses, sem guardar', async () => {
    comChaves('openai', 'anthropic')
    const admin = fakeAdmin([{ data: pdfBase }, { data: { id: 'm1' } }, { data: { id: 'm1' } }], [])
    const f = fakeFetch({ contentType: 'application/pdf' })
    vi.stubGlobal('fetch', f)

    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'pronta', texto: 'Extrato do Banco X, saldo R$ 1.200,00' })
    const [url, init] = chamadasAoProvedor(f)[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const corpo = JSON.parse(String(init.body)) as { store: boolean; input: { content: { type: string; filename?: string }[] }[] }
    expect(corpo.store).toBe(false)
    expect(corpo.input[0].content[0]).toMatchObject({ type: 'input_file', filename: 'extrato.pdf' })
    expect(logAiUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: 'openai', model: 'gpt-5.4-mini' }))
  })

  it('PDF pela ANTHROPIC quando só ela tem chave: bloco `document`', async () => {
    comChaves('anthropic')
    const admin = fakeAdmin([{ data: pdfBase }, { data: { id: 'm1' } }, { data: { id: 'm1' } }], [])
    const f = fakeFetch({ contentType: 'application/pdf' })
    vi.stubGlobal('fetch', f)

    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'pronta', texto: 'Contrato de honorários, 20%' })
    const corpo = JSON.parse(String((chamadasAoProvedor(f)[0] as [string, RequestInit])[1].body)) as {
      messages: { content: { type: string }[] }[]
    }
    expect(corpo.messages[0].content[0].type).toBe('document')
    expect(logAiUsage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ provider: 'anthropic', model: 'claude-sonnet-5' }))
  })

  it('documento que NENHUM provedor lê (docx): `recusada` GRAVADA, sem chave nem download', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [{ data: { ...pdfBase, media_type: null, media_filename: 'procuracao.docx' } }, { error: null }],
      chamadas,
    )
    const f = fakeFetch()
    vi.stubGlobal('fetch', f)
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'recusada', erro: RECUSA.tipo })
    expect(f).not.toHaveBeenCalled()
    expect(lerChave).not.toHaveBeenCalled()
    const grava = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(grava.payload).toMatchObject({ transcricao_status: 'recusada', transcricao_erro: RECUSA.tipo })
  })

  it('GRANDE DEMAIS pelo tamanho declarado: `recusada` gravada com a cerca, sem baixar o corpo nem chamar o provedor', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
    const f = fakeFetch({ contentLength: 30 * 1024 * 1024 })
    vi.stubGlobal('fetch', f)
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'recusada', erro: RECUSA.grande })
    expect(chamadasAoProvedor(f)).toHaveLength(0)
    const grava = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(grava.payload?.transcricao_status).toBe('recusada')
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_desde|')
  })

  it('o limite é o do provedor ESCOLHIDO: 8 MB de imagem passa no Gemini e não na Anthropic', async () => {
    comChaves('anthropic')
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
    const f = fakeFetch({ bytes: 8 * 1024 * 1024 })
    vi.stubGlobal('fetch', f)
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'recusada', erro: RECUSA.grande })
    expect(chamadasAoProvedor(f)).toHaveLength(0)
  })

  it('SEM chave nenhuma: `sem_leitor` SEM gravar — cadastrar a chave reativa a leitura', async () => {
    comChaves()
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }], chamadas)
    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('sem_leitor')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('HEIC com chave só da OpenAI: formato de OUTRO provedor, `sem_leitor` SEM gravar e sem baixar', async () => {
    comChaves('openai')
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: { ...msgBase, media_type: 'image/heic' } }], chamadas)
    const f = fakeFetch()
    vi.stubGlobal('fetch', f)
    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('sem_leitor')
    expect(f).not.toHaveBeenCalled()
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('⚠️ documento SEM tipo que o download revela ser de OUTRO provedor: solta o cadeado SEM gastar a tentativa e grava o tipo — a próxima vez nem baixa', async () => {
    comChaves('openai')
    const chamadas: Chamada[] = []
    const semTipo = { ...pdfBase, media_type: null, media_filename: null, media_url: 'https://b.supabase.co/x/1-file.bin', transcricao_status: 'falhou', transcricao_tentativas: 1 }
    const admin = fakeAdmin([{ data: semTipo }, { data: { id: 'm1' } }, { error: null }], chamadas)
    const f = fakeFetch({ contentType: 'image/heic' })
    vi.stubGlobal('fetch', f)
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('sem_leitor')
    expect(chamadasAoProvedor(f)).toHaveLength(0)
    const solta = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(solta.payload).toEqual({
      transcricao_status: 'falhou',
      transcricao_desde: null,
      transcricao_tentativas: 1,
      media_type: 'image/heic',
    })
    expect(solta.filtros.join(' ')).toContain('eq(transcricao_desde|')

    // A volta seguinte: com o tipo gravado, recusa ANTES do download e do cadeado.
    const chamadas2: Chamada[] = []
    const f2 = fakeFetch()
    vi.stubGlobal('fetch', f2)
    const admin2 = fakeAdmin([{ data: { ...semTipo, media_type: 'image/heic' } }], chamadas2)
    expect((await lerMidia(admin2, { accountId: 'a1', messageId: 'm1' })).status).toBe('sem_leitor')
    expect(f2).not.toHaveBeenCalled()
    expect(chamadas2.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('falha ao LER a chave: `falhou` sem gravar', async () => {
    vi.mocked(lerChave).mockRejectedValue(new Error('timeout'))
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }], chamadas)
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('falhou')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('teto de tokens NÃO é recusa: grava o que leu, com o corte declarado', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { data: { id: 'm1' } }], chamadas)
    vi.stubGlobal(
      'fetch',
      fakeFetch({
        provedor: {
          candidates: [{ content: { parts: [{ text: 'metade do documento' }] }, finishReason: 'MAX_TOKENS' }],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
        },
      }),
    )
    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'pronta', texto: `metade do documento\n${MARCA_DE_CORTE}` })
  })

  it('erro do provedor: `falhou` retentável, com a cerca e sem a chave no motivo', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
    vi.stubGlobal('fetch', fakeFetch({ status: 401 }))
    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'falhou', erro: 'Gemini recusou a chave (HTTP 401)' })
    const grava = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(grava.payload?.transcricao_status).toBe('falhou')
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_desde|')
  })

  // ---- A falha PASSAGEIRA não gasta tentativa ----

  it.each([401, 404, 429, 503, 529])(
    '⚠️ HTTP %i do provedor (chave, modelo, cota, fora do ar) NÃO gasta tentativa: o contador volta ao de antes',
    async (status) => {
      const chamadas: Chamada[] = []
      const admin = fakeAdmin(
        [{ data: { ...msgBase, transcricao_status: 'falhou', transcricao_tentativas: 2 } }, { data: { id: 'm1' } }, { error: null }],
        chamadas,
      )
      vi.stubGlobal('fetch', fakeFetch({ status }))
      expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('falhou')
      const [claim, falha] = chamadas.filter((c) => c.op === 'update')
      expect(claim.payload?.transcricao_tentativas).toBe(3)
      expect(falha.payload).toMatchObject({ transcricao_status: 'falhou', transcricao_tentativas: 2 })
    },
  )

  it('HTTP 400 do provedor (o arquivo) GASTA a tentativa', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
    vi.stubGlobal('fetch', fakeFetch({ status: 400 }))
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('falhou')
    const falha = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(falha.payload?.transcricao_status).toBe('falhou')
    expect(falha.payload).not.toHaveProperty('transcricao_tentativas')
  })

  it('rede fora (o `fetch` lança `TypeError`) é passageira', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
    const f = fakeFetch()
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchFalso>(async (url, init) => {
        if (String(url).includes('generativelanguage')) throw new TypeError('fetch failed')
        return f(url, init)
      }),
    )
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'falhou', erro: 'fetch failed' })
    expect(chamadas.filter((c) => c.op === 'update').at(-1)!.payload).toMatchObject({ transcricao_tentativas: 0 })
  })

  it('download: 503 do Storage é passageiro; 404 (o arquivo sumiu) gasta a tentativa', async () => {
    for (const [status, conta] of [
      [503, false],
      [404, true],
    ] as const) {
      const chamadas: Chamada[] = []
      const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchFalso>(async () => ({ ok: false, status, headers: { get: () => null } })),
      )
      expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('falhou')
      const falha = chamadas.filter((c) => c.op === 'update').at(-1)!
      expect('transcricao_tentativas' in (falha.payload ?? {})).toBe(!conta)
    }
  })

  it('⚠️ PDF: o prazo da chamada é o da LEITURA (90 s, não os 30 s do chat), e o tempo esgotado é passageiro', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const chamadas: Chamada[] = []
      const admin = fakeAdmin([{ data: pdfBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
      const download = fakeFetch({ contentType: 'application/pdf' })
      vi.stubGlobal(
        'fetch',
        vi.fn<FetchFalso>(async (url, init) => {
          if (!String(url).includes('generativelanguage')) return download(url, init)
          // O provedor que nunca responde: só o prazo o encerra.
          return new Promise((_ok, falha) => {
            init?.signal?.addEventListener('abort', () => {
              const e = new Error('This operation was aborted')
              e.name = 'AbortError'
              falha(e)
            })
          })
        }),
      )
      let resultado: unknown = null
      void lerMidia(admin, { accountId: 'a1', messageId: 'm1' }).then((r) => (resultado = r))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(resultado).toBeNull() // passou dos 30 s e dos 45 s, e segue esperando
      await vi.advanceTimersByTimeAsync(31_000)
      expect(resultado).toEqual({ status: 'falhou', erro: 'tempo esgotado' })
      expect(chamadas.filter((c) => c.op === 'update').at(-1)!.payload).toMatchObject({ transcricao_tentativas: 0 })
    } finally {
      vi.useRealTimers()
    }
  })

  // ---- A leitura BLOQUEADA não vira conteúdo ----

  it.each([
    [
      'gemini',
      {
        candidates: [{ content: { parts: [{ text: 'trecho recitado' }] }, finishReason: 'RECITATION' }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 5, totalTokenCount: 10 },
      },
    ],
    [
      'openai',
      {
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'meio' }] }],
        usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 },
      },
    ],
    [
      'anthropic',
      { content: [{ type: 'text', text: 'Não posso ajudar com isso.' }], stop_reason: 'refusal', usage: { input_tokens: 5, output_tokens: 5 } },
    ],
  ] as const)('⚠️ %s bloqueou ou recusou: `falhou` (conta), o texto que veio NUNCA é gravado como leitura', async (provedor, resposta) => {
    comChaves(provedor)
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }, { data: { id: 'm1' } }, { error: null }], chamadas)
    vi.stubGlobal('fetch', fakeFetch({ provedor: resposta }))
    const r = await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('falhou')
    expect(chamadas.some((c) => c.payload?.transcricao_status === 'pronta')).toBe(false)
    expect(chamadas.some((c) => typeof c.payload?.transcricao === 'string')).toBe(false)
    const falha = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(falha.payload?.transcricao_status).toBe('falhou')
    expect(falha.payload).not.toHaveProperty('transcricao_tentativas')
    // Cobrado assim mesmo: o custo fica registrado.
    expect(logAiUsage).toHaveBeenCalled()
  })

  it('⚠️ PDF à OpenAI com nome SEM ".pdf": o `filename` enviado termina em ".pdf"', async () => {
    comChaves('openai')
    const admin = fakeAdmin(
      [{ data: { ...pdfBase, media_filename: 'Extrato setembro' } }, { data: { id: 'm1' } }, { data: { id: 'm1' } }],
      [],
    )
    const f = fakeFetch({ contentType: 'application/pdf' })
    vi.stubGlobal('fetch', f)
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('pronta')
    const corpo = JSON.parse(String((chamadasAoProvedor(f)[0] as [string, RequestInit])[1].body)) as {
      input: { content: { filename?: string }[] }[]
    }
    expect(corpo.input[0].content[0].filename).toBe('Extrato setembro.pdf')
  })

  it('CADEADO perdido: devolve o estado real sem cobrar', async () => {
    const admin = fakeAdmin(
      [
        { data: msgBase },
        { data: null },
        { data: { transcricao: null, transcricao_status: 'transcrevendo', transcricao_erro: null, transcricao_tentativas: 1 } },
      ],
      [],
    )
    const f = fakeFetch()
    vi.stubGlobal('fetch', f)
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'lendo' })
    expect(f).not.toHaveBeenCalled()
  })

  it('tentativas esgotadas viram `recusada` TERMINAL', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [
        { data: { ...msgBase, transcricao_status: 'falhou', transcricao_tentativas: 3 } },
        { data: null },
        { data: { transcricao: null, transcricao_status: 'falhou', transcricao_erro: 'x', transcricao_tentativas: 3 } },
        { error: null },
      ],
      chamadas,
    )
    expect(await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).toEqual({ status: 'recusada', erro: RECUSA.esgotadas })
  })

  it('documento sem tipo nem nome: decide pelo `Content-Type` do download', async () => {
    const admin = fakeAdmin(
      [
        { data: { ...pdfBase, media_type: null, media_filename: null, media_url: 'https://b.supabase.co/x/1-file.bin' } },
        { data: { id: 'm1' } },
        { data: { id: 'm1' } },
      ],
      [],
    )
    const f = fakeFetch({ contentType: 'application/pdf' })
    vi.stubGlobal('fetch', f)
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('pronta')
    expect(String((chamadasAoProvedor(f)[0] as [string, RequestInit])[1].body)).toContain('"mimeType":"application/pdf"')
  })

  it('arquivo RECÉM-CHEGADO sem URL: `falhou` sem gravar (o arquivo chega segundos depois)', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: { ...msgBase, media_url: null, created_at: new Date().toISOString() } }], chamadas)
    expect((await lerMidia(admin, { accountId: 'a1', messageId: 'm1' })).status).toBe('falhou')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })
})

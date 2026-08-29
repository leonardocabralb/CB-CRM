import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/ai/config', () => ({ loadAiConfig: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}) }))

import { loadAiConfig } from '@/lib/ai/config'
import { logAiUsage } from '@/lib/ai/usage'
import { MODELO_TRANSCRICAO, transcreverAudio } from './transcrever'

// ------------------------------------------------------------
// Stub do supabase: cada `from()` vira um registro (tabela, operação,
// payload, filtros) e consome UMA resposta da fila — a ordem da fila é a
// ordem real das queries do módulo, então um caminho que fizer uma query
// a mais/a menos quebra o teste em vez de passar por sorte.
// ------------------------------------------------------------
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
      const proxima = () =>
        Promise.resolve(respostas.shift() ?? { data: null, error: null })
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
        // `falhar`/`gravarTerminal` fazem `await query` direto — o
        // builder real do supabase é thenable, o stub também.
        then(res: (v: Resposta) => unknown, rej?: (e: unknown) => unknown) {
          return proxima().then(res, rej)
        },
      }
      for (const m of ['eq', 'neq', 'is', 'lt', 'or'] as const) {
        builder[m] = (...args: unknown[]) => {
          chamada.filtros.push(`${m}(${args.map(String).join('|')})`)
          return builder
        }
      }
      return builder
    },
  } as never
}

const msgBase = {
  id: 'm1',
  conversation_id: 'c1',
  content_type: 'audio',
  content_text: null,
  media_url: 'https://bucket.supabase.co/storage/v1/object/public/chat-media/a.ogg',
  media_type: 'audio/ogg',
  created_at: '2026-08-01T12:00:00Z', // antiga — fora da janela de download
  deleted_at: null,
  transcricao: null,
  transcricao_status: null,
  transcricao_erro: null,
  transcricao_tentativas: 0,
  conversation: { account_id: 'a1', channel_id: 'ch1' },
}
const configGemini = { provider: 'gemini', model: 'chat-model', apiKey: 'chave-g' }

const respostaGemini = {
  candidates: [
    { content: { parts: [{ text: ' Oi doutor, preciso da procuração. ' }] }, finishReason: 'STOP' },
  ],
  usageMetadata: { promptTokenCount: 960, candidatesTokenCount: 12, totalTokenCount: 972 },
}

function fakeFetchOk() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (String(url).includes('generativelanguage')) {
      return {
        ok: true,
        status: 200,
        json: async () => respostaGemini,
        text: async () => '',
      }
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'audio/ogg' },
      arrayBuffer: async () => new ArrayBuffer(64),
    }
  })
}

beforeEach(() => {
  vi.mocked(loadAiConfig).mockResolvedValue(configGemini as never)
  vi.mocked(logAiUsage).mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('transcreverAudio', () => {
  it('IDEMPOTÊNCIA: transcrição pronta volta sem gastar nada', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [{ data: { ...msgBase, transcricao: 'já estava pronta' } }],
      chamadas,
    )
    const fetchSpy = fakeFetchOk()
    vi.stubGlobal('fetch', fetchSpy)

    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'pronta', transcricao: 'já estava pronta' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(chamadas).toHaveLength(1)
  })

  it('conta errada = "não encontrada" (service-role ignora RLS; a guarda é o código)', async () => {
    const admin = fakeAdmin(
      [{ data: { ...msgBase, conversation: { account_id: 'OUTRA', channel_id: 'ch1' } } }],
      [],
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
  })

  it('a chave é resolvida PELO CANAL da conversa, como a análise do Radar', async () => {
    // Sem o canal, conta com padrão OpenAI e agente Gemini no canal
    // recusava tudo — e o inverso mandava o áudio ao Google num canal
    // apontado para outro provedor.
    const admin = fakeAdmin(
      [{ data: msgBase }, { data: { id: 'm1' } }, { data: { id: 'm1' } }],
      [],
    )
    vi.stubGlobal('fetch', fakeFetchOk())
    await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(loadAiConfig).toHaveBeenCalledWith(expect.anything(), 'a1', {
      requireActive: false,
      channelId: 'ch1',
    })
  })

  it('MAX_TOKENS registra o uso e vira recusada TERMINAL (determinístico)', async () => {
    // A temperatura 0, o mesmo áudio dá o mesmo corte — retentar seria
    // pagar de novo pelo mesmo resultado. E a chamada JÁ foi cobrada.
    const admin = fakeAdmin(
      [{ data: msgBase }, { data: { id: 'm1' } }, { error: null }],
      [],
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('generativelanguage')) {
          return {
            ok: true,
            status: 200,
            text: async () => '',
            json: async () => ({
              candidates: [{ content: { parts: [{ text: 'metade da fala' }] }, finishReason: 'MAX_TOKENS' }],
              usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 4096, totalTokenCount: 9096 },
            }),
          }
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'audio/ogg' },
          arrayBuffer: async () => new ArrayBuffer(64),
        }
      }),
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
    expect(logAiUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'transcricao' }),
    )
  })

  it('áudio apagado não se transcreve — e nada é gravado', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [{ data: { ...msgBase, deleted_at: '2026-08-01T00:00:00Z' } }],
      chamadas,
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('media_url RELATIVA (proxy Meta) é recusada gravada — server não tem sessão', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [{ data: { ...msgBase, media_url: '/api/whatsapp/media/abc' } }, { error: null }],
      chamadas,
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
    const grava = chamadas.find((c) => c.op === 'update')
    expect(grava?.payload?.transcricao_status).toBe('recusada')
  })

  it('áudio RECÉM-CHEGADO sem arquivo é transitório: falhou SEM gravar', async () => {
    // O webhook grava a mensagem primeiro e o media_url segundos depois —
    // o Radar chega nessa janela porque prioriza a conversa mais recente.
    // Recusar em definitivo aqui matava o áudio para sempre.
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [{ data: { ...msgBase, media_url: null, created_at: new Date().toISOString() } }],
      chamadas,
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('falhou')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('SEM chave: recusada SEM gravar — configurar a chave reativa o botão', async () => {
    vi.mocked(loadAiConfig).mockResolvedValue(null)
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }], chamadas)
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('provedor não-Gemini: recusada sem gravar (transcrição é Gemini-only)', async () => {
    vi.mocked(loadAiConfig).mockResolvedValue({ ...configGemini, provider: 'openai' } as never)
    const chamadas: Chamada[] = []
    const admin = fakeAdmin([{ data: msgBase }], chamadas)
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
    expect(chamadas.filter((c) => c.op === 'update')).toHaveLength(0)
  })

  it('CADEADO perdido: devolve o estado real sem cobrar', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [
        { data: msgBase },
        { data: null }, // claim: outra requisição chegou antes
        { data: { transcricao: null, transcricao_status: 'transcrevendo', transcricao_erro: null, transcricao_tentativas: 1 } },
      ],
      chamadas,
    )
    const fetchSpy = fakeFetchOk()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'transcrevendo' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('tentativas esgotadas viram recusada TERMINAL', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [
        { data: { ...msgBase, transcricao_status: 'falhou', transcricao_tentativas: 3 } },
        { data: null }, // claim barrado pelo lt(tentativas,3)
        { data: { transcricao: null, transcricao_status: 'falhou', transcricao_erro: 'x', transcricao_tentativas: 3 } },
        { error: null }, // gravarTerminal
      ],
      chamadas,
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('recusada')
    const grava = chamadas.filter((c) => c.op === 'update').at(-1)
    expect(grava?.payload?.transcricao_status).toBe('recusada')
  })

  it('SUCESSO: chave no header, cerca de posse na gravação e uso registrado', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [
        { data: msgBase },
        { data: { id: 'm1' } }, // claim
        { data: { id: 'm1' } }, // gravação final
      ],
      chamadas,
    )
    const fetchSpy = fakeFetchOk()
    vi.stubGlobal('fetch', fetchSpy)

    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r).toEqual({ status: 'pronta', transcricao: 'Oi doutor, preciso da procuração.' })

    const geminiCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes('generativelanguage'))!
    const init = geminiCall[1] as unknown as {
      headers: Record<string, string>
      body: string
    }
    // ⚠️ Header, nunca `?key=` — URL vaza em log de proxy.
    expect(init.headers['x-goog-api-key']).toBe('chave-g')
    expect(String(geminiCall[0])).not.toContain('key=')
    expect(init.body).toContain('inlineData')

    const grava = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(grava.payload?.transcricao_status).toBe('pronta')
    // A cerca: só grava se AINDA formos os donos do claim.
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_status|transcrevendo)')
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_desde|')
    // O claim amarra o contador LIDO — sem isto, claim concorrente entre o
    // SELECT e o UPDATE fazia as tentativas regredirem (teto virava 4+).
    const claim = chamadas.filter((c) => c.op === 'update').at(0)!
    expect(claim.filtros.join(' ')).toContain('eq(transcricao_tentativas|0)')

    expect(logAiUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ mode: 'transcricao', provider: 'gemini' }),
    )
  })

  // Duas garantias diferentes, e as duas fazem falta:
  //
  // 1. O LITERAL escrito à mão. As asserções que comparam o código com a
  //    própria constante são tautológicas — passam com ela mistypada.
  //    Sem o literal, `gemini-3.7-flsah` atravessa typecheck, lint e a
  //    suíte inteira e só aparece em produção: a URL dá 404, o áudio vira
  //    `falhou` e, na 3ª tentativa, `recusada` TERMINAL, que não tem botão
  //    na bolha. No caminho do Radar isso é silencioso. Trocar de modelo
  //    de propósito passa a exigir editar aqui também — deliberado: a
  //    escolha saiu de medição e está documentada na constante.
  // 2. O PAR URL ↔ `logAiUsage`. Os dois lados são conferidos separados,
  //    então chumbar um modelo diferente em qualquer um deles quebra —
  //    é a armadilha que o CLAUDE.md registra para o worker do Radar
  //    (custo atribuído ao modelo errado).
  it('o modelo escolhido vai para a URL E para o registro de custo', async () => {
    const admin = fakeAdmin(
      [{ data: msgBase }, { data: { id: 'm1' } }, { data: { id: 'm1' } }],
      [],
    )
    const fetchSpy = fakeFetchOk()
    vi.stubGlobal('fetch', fetchSpy)

    await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })

    expect(MODELO_TRANSCRICAO).toBe('gemini-3.7-flash')

    const url = String(
      fetchSpy.mock.calls.find((c) => String(c[0]).includes('generativelanguage'))![0],
    )
    expect(url).toContain(`/models/${MODELO_TRANSCRICAO}:generateContent`)
    expect(logAiUsage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: MODELO_TRANSCRICAO }),
    )
  })

  it('erro do Gemini grava `falhou` retentável, com a cerca', async () => {
    const chamadas: Chamada[] = []
    const admin = fakeAdmin(
      [{ data: msgBase }, { data: { id: 'm1' } }, { error: null }],
      chamadas,
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('generativelanguage')) {
          return { ok: false, status: 500, text: async () => 'boom', json: async () => null }
        }
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'audio/ogg' },
          arrayBuffer: async () => new ArrayBuffer(64),
        }
      }),
    )
    const r = await transcreverAudio(admin, { accountId: 'a1', messageId: 'm1' })
    expect(r.status).toBe('falhou')
    const grava = chamadas.filter((c) => c.op === 'update').at(-1)!
    expect(grava.payload?.transcricao_status).toBe('falhou')
    expect(grava.filtros.join(' ')).toContain('eq(transcricao_desde|')
  })
})

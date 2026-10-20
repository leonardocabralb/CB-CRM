import { describe, expect, it, vi } from 'vitest'

import { ARQUIVOS_PADRAO, TETO_DE_BYTES_DA_MARCA } from '@/lib/marca'

import { simboloComoDataUrl, tracoSobre } from './marca-icone'

// ============================================================
// O símbolo dos ícones gerados (aba e app instalado). A regra que importa:
// NUNCA lança — toda falha é `null`, e o ícone cai no desenho genérico.
// Um ícone que responde 500 some da aba e da Tela de Início sem aviso.
//
// ⚠️ A memória do módulo guarda o último símbolo que deu certo: cada teste
// usa uma URL própria.
// ============================================================

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const URL_BASE = 'https://storage.exemplo.com/storage/v1/object/public/marca'

function resposta(corpo: BodyInit | null, init: { status?: number; tipo?: string; headers?: Record<string, string> } = {}): Response {
  return new Response(corpo, {
    status: init.status ?? 200,
    headers: { ...(init.tipo === undefined ? { 'content-type': 'image/png' } : init.tipo ? { 'content-type': init.tipo } : {}), ...init.headers },
  })
}

const comFetch = (r: Response | (() => Promise<Response>)) =>
  vi.fn(typeof r === 'function' ? r : async () => r) as unknown as typeof fetch & ReturnType<typeof vi.fn>

describe('simboloComoDataUrl — arquivo de public/ (o padrão do produto)', () => {
  it('lê o símbolo padrão do disco e devolve o PNG embutido', async () => {
    const dataUrl = await simboloComoDataUrl(ARQUIVOS_PADRAO.simbolo)
    // `iVBORw0KGgo` é a assinatura do PNG em base64.
    expect(dataUrl).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
  })

  it('arquivo que não existe: null, sem lançar', async () => {
    await expect(simboloComoDataUrl('/marca/nao-existe.png')).resolves.toBeNull()
  })

  it('caminho com `..` não sai de public/', async () => {
    await expect(simboloComoDataUrl('/../package.json')).resolves.toBeNull()
  })

  it('arquivo que não é PNG: null', async () => {
    await expect(simboloComoDataUrl('/inbox-doodle.svg')).resolves.toBeNull()
  })

  it('sem símbolo: null, sem tocar em nada', async () => {
    const fetchFn = comFetch(resposta(PNG))
    await expect(simboloComoDataUrl(null, { fetchFn })).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('simboloComoDataUrl — URL do Storage (a marca própria)', () => {
  it('baixa com prazo e sem seguir redirecionamento, e devolve o PNG embutido', async () => {
    const fetchFn = comFetch(resposta(PNG))
    const dataUrl = await simboloComoDataUrl(`${URL_BASE}/ok.png`, { fetchFn })
    expect(dataUrl).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect(init.redirect).toBe('manual')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    ['404', () => resposta('não achei', { status: 404, tipo: 'text/plain' })],
    ['redirecionamento', () => resposta(null, { status: 302, tipo: '', headers: { location: 'http://127.0.0.1/x.png' } })],
    ['content-type que não é PNG', () => resposta(PNG, { tipo: 'image/webp' })],
    ['sem content-type', () => resposta(PNG, { tipo: '' })],
    ['corpo acima do teto do bucket', () => resposta(PNG, { headers: { 'content-length': String(TETO_DE_BYTES_DA_MARCA + 1) } })],
    ['bytes que não são PNG (o Storage declarou errado)', () => resposta(new Uint8Array(32).fill(1))],
  ])('%s: null', async (caso, montar) => {
    const fetchFn = comFetch(async () => montar())
    await expect(simboloComoDataUrl(`${URL_BASE}/${encodeURIComponent(caso)}.png`, { fetchFn })).resolves.toBeNull()
  })

  it('rede que cai ou prazo estourado: null, sem lançar', async () => {
    const fetchFn = comFetch(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    await expect(simboloComoDataUrl(`${URL_BASE}/lento.png`, { fetchFn })).resolves.toBeNull()
  })

  it('protocolo que não é http(s): null, sem buscar', async () => {
    const fetchFn = comFetch(resposta(PNG))
    await expect(simboloComoDataUrl('file:///etc/passwd', { fetchFn })).resolves.toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('o mesmo símbolo não é baixado de novo; a FALHA não fica na memória', async () => {
    const url = `${URL_BASE}/memoria.png`
    const falha = comFetch(resposta('erro', { status: 500, tipo: 'text/plain' }))
    await expect(simboloComoDataUrl(url, { fetchFn: falha })).resolves.toBeNull()

    const ok = comFetch(resposta(PNG))
    const primeira = await simboloComoDataUrl(url, { fetchFn: ok })
    const segunda = await simboloComoDataUrl(url, { fetchFn: ok })
    expect(primeira).not.toBeNull()
    expect(segunda).toBe(primeira)
    expect(ok).toHaveBeenCalledTimes(1)
  })
})

describe('tracoSobre', () => {
  it('traço escuro em fundo claro, branco em fundo escuro (o balão genérico nunca some)', () => {
    expect(tracoSobre('#ffffff')).toBe('#020617')
    expect(tracoSobre('#fde047')).toBe('#020617')
    expect(tracoSobre('#020617')).toBe('#ffffff')
    expect(tracoSobre('#7c3aed')).toBe('#ffffff')
  })
})

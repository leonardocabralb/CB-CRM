import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// /api/cb/marca — quem troca a marca, o que a rota recusa e a ORDEM das
// escritas (subir → gravar → revalidar → apagar o substituído).
//
// Dublês: a sessão (`requireRole`/`getCurrentAccount` com o papel de cada
// caso, lançando o `ForbiddenError` de verdade), a conta da instalação, o
// `next/cache` e o service role — uma linha `cb_marca` em memória com a
// semântica do upsert do PostgREST (só as colunas enviadas mudam) e um
// bucket que registra upload e remoção. O `lerLinhaDaMarca` é o de verdade,
// lendo dessa linha.
// ============================================================

const sessao = vi.hoisted(() => ({
  papel: 'admin' as 'owner' | 'admin' | 'agent' | 'viewer',
  conta: 'conta-dona',
}))
const contaDaInstalacao = vi.hoisted(() => vi.fn(async (): Promise<string | null> => 'conta-dona'))
const revalidateTag = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/account', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/account')>()
  const { hasMinRole } = await import('@/lib/auth/roles')
  const ctx = () => ({
    supabase: {},
    userId: 'usuario-1',
    accountId: sessao.conta,
    role: sessao.papel,
    account: { id: sessao.conta, name: 'Conta' },
  })
  return {
    ...real,
    getCurrentAccount: vi.fn(async () => ctx()),
    requireRole: vi.fn(async (min: 'owner' | 'admin' | 'agent' | 'viewer') => {
      if (!hasMinRole(sessao.papel, min)) throw new real.ForbiddenError(`This action requires the '${min}' role or higher`)
      return ctx()
    }),
  }
})
vi.mock('next/cache', () => ({
  revalidateTag,
  unstable_cache: (fn: () => unknown) => fn,
}))
vi.mock('@/lib/marca-servidor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/marca-servidor')>()),
  contaDaInstalacao,
}))

// ---------- o banco e o bucket em memória ----------
type Linha = Record<string, unknown>
const banco = vi.hoisted(() => ({
  linha: null as Linha | null,
  erroNaLeitura: null as { message: string } | null,
  erroNaGravacao: null as { message: string } | null,
  /** O status HTTP do erro: 4xx = recusa comprovada; 5xx/504 = incerto. */
  statusNaGravacao: 400,
  /** Grava e AINDA ASSIM devolve erro (tempo esgotado depois do COMMIT). */
  gravaEFalha: false,
  /** O upsert LANÇA (rede caiu no meio). */
  lancaNaGravacao: false,
  erroNoDelete: null as { message: string } | null,
  erroNoUpload: null as { message: string } | null,
  gravacoes: [] as Linha[],
}))
const upload = vi.hoisted(() => vi.fn())
const remove = vi.hoisted(() => vi.fn())

function projetar(linha: Linha | null, colunas: string): Linha | null {
  if (!linha) return null
  return Object.fromEntries(colunas.split(',').map((c) => [c.trim(), linha[c.trim()] ?? null]))
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      if (tabela !== 'cb_marca') throw new Error(`tabela inesperada: ${tabela}`)
      return {
        select: (colunas: string) => ({
          maybeSingle: async () =>
            banco.erroNaLeitura
              ? { data: null, error: banco.erroNaLeitura }
              : { data: projetar(banco.linha, colunas), error: null },
        }),
        upsert: (valores: Linha, opcoes: { onConflict: string }) => ({
          select: (colunas: string) => ({
            single: async () => {
              expect(opcoes.onConflict).toBe('id')
              banco.gravacoes.push(valores)
              if (banco.lancaNaGravacao) throw new TypeError('fetch failed')
              if (banco.erroNaGravacao && !banco.gravaEFalha) {
                return { data: null, error: banco.erroNaGravacao, status: banco.statusNaGravacao }
              }
              // O upsert do PostgREST: só as colunas ENVIADAS mudam.
              banco.linha = { ...(banco.linha ?? {}), ...valores }
              if (banco.gravaEFalha) return { data: null, error: { message: 'timeout' }, status: 504 }
              return { data: projetar(banco.linha, colunas), error: null, status: 201 }
            },
          }),
        }),
        delete: () => ({
          eq: (coluna: string, valor: unknown) => ({
            select: async (colunas: string) => {
              expect([coluna, valor]).toEqual(['id', true])
              if (banco.erroNoDelete) return { data: null, error: banco.erroNoDelete }
              const saiu = banco.linha
              banco.linha = null
              return { data: saiu ? [projetar(saiu, colunas)] : [], error: null }
            },
          }),
        }),
      }
    },
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe('marca')
        return {
          upload: async (caminho: string, corpo: Uint8Array, opcoes: unknown) => {
            upload(caminho, corpo, opcoes)
            return banco.erroNoUpload ? { data: null, error: banco.erroNoUpload } : { data: { path: caminho }, error: null }
          },
          remove: async (caminhos: string[]) => {
            remove(caminhos)
            return { data: [], error: null }
          },
          getPublicUrl: (caminho: string) => ({ data: { publicUrl: `https://storage.test/marca/${caminho}` } }),
        }
      },
    },
  }),
}))

import { TETO_DE_BYTES_DA_MARCA } from '@/lib/marca'
import { DELETE, GET, POST } from './route'

// ---------- arquivos ----------
/**
 * Começo de um PNG (assinatura + IHDR): é só o que a rota lê para conferir
 * tipo e dimensões. O PNG completo, gerado de verdade, está no teste de
 * `marca-validacao`.
 */
function png(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const v = new DataView(b.buffer)
  v.setUint32(8, 13)
  b.set([0x49, 0x48, 0x44, 0x52], 12) // IHDR
  v.setUint32(16, largura)
  v.setUint32(20, altura)
  return b
}
const arquivo = (bytes: Uint8Array, nome: string, tipo: string) =>
  new File([bytes as Uint8Array<ArrayBuffer>], nome, { type: tipo })
const simbolo = () => arquivo(png(512, 512), 'simbolo.png', 'image/png')

function pedido(campos: [string, string | File][], metodo = 'POST') {
  const form = new FormData()
  for (const [chave, valor] of campos) form.append(chave, valor)
  return new Request('http://crm.test/api/cb/marca', { method: metodo, body: form })
}
async function respostaDe(r: Response) {
  return { status: r.status, corpo: await r.json() }
}

const LINHA_ATUAL: Linha = {
  id: true,
  nome: 'Marca Antiga',
  nome_curto: 'Antiga',
  cor_do_icone: '#112233',
  simbolo_path: 'simbolo/antigo.png',
  horizontal_escuro_path: 'horizontal-escuro/antigo.svg',
  horizontal_claro_path: 'horizontal-claro/antigo.png',
  vertical_escuro_path: null,
  vertical_claro_path: null,
  atualizado_em: '2026-01-01T00:00:00.000Z',
}

beforeEach(() => {
  sessao.papel = 'admin'
  sessao.conta = 'conta-dona'
  contaDaInstalacao.mockImplementation(async () => 'conta-dona')
  banco.linha = null
  banco.erroNaLeitura = null
  banco.erroNaGravacao = null
  banco.statusNaGravacao = 400
  banco.gravaEFalha = false
  banco.lancaNaGravacao = false
  banco.erroNoDelete = null
  banco.erroNoUpload = null
  banco.gravacoes = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('GET /api/cb/marca', () => {
  it('membro comum lê a marca, mas não edita (nao_admin) — sem perguntar a conta da instalação', async () => {
    sessao.papel = 'agent'
    const { status, corpo } = await respostaDe(await GET())
    expect(status).toBe(200)
    expect(corpo).toMatchObject({ linha: null, podeEditar: false, motivo: 'nao_admin' })
    expect(corpo.marca).toMatchObject({ propria: false, nome: 'Atlas CRM' })
    expect(contaDaInstalacao).not.toHaveBeenCalled()
  })

  it('admin de uma conta avulsa: nao_e_a_conta_da_instalacao', async () => {
    sessao.conta = 'conta-avulsa'
    const { status, corpo } = await respostaDe(await GET())
    expect(status).toBe(200)
    expect(corpo).toMatchObject({ podeEditar: false, motivo: 'nao_e_a_conta_da_instalacao' })
  })

  it('admin da instalação: a marca resolvida da linha LIDA AGORA, com as URLs derivadas', async () => {
    banco.linha = { ...LINHA_ATUAL }
    const { status, corpo } = await respostaDe(await GET())
    expect(status).toBe(200)
    expect(corpo).toMatchObject({ podeEditar: true, motivo: null })
    expect(corpo.linha).toMatchObject({ nome: 'Marca Antiga', simbolo_path: 'simbolo/antigo.png' })
    expect(corpo.marca).toMatchObject({
      propria: true,
      nome: 'Marca Antiga',
      simbolo: 'https://storage.test/marca/simbolo/antigo.png',
      verticalEscuro: null,
    })
  })

  it('erro de leitura é 500 falha_no_banco — nunca o padrão fingido', async () => {
    banco.erroNaLeitura = { message: 'timeout' }
    expect(await respostaDe(await GET())).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
  })

  it('conta da instalação ilegível é 500, nunca "não é você"', async () => {
    contaDaInstalacao.mockRejectedValueOnce(new Error('accounts: timeout'))
    expect(await respostaDe(await GET())).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
  })
})

describe('POST /api/cb/marca — quem pode', () => {
  it('não-admin: 403 do requireRole, nada sobe nem grava', async () => {
    sessao.papel = 'agent'
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(r.status).toBe(403)
    expect(upload).not.toHaveBeenCalled()
    expect(banco.gravacoes).toEqual([])
  })

  it('admin de conta que não é a da instalação: 403 nao_e_a_conta_da_instalacao', async () => {
    sessao.conta = 'conta-avulsa'
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 403, corpo: { erro: 'nao_e_a_conta_da_instalacao' } })
    expect(upload).not.toHaveBeenCalled()
  })

  it('conta da instalação ilegível: 500 falha_no_banco, nunca 403', async () => {
    contaDaInstalacao.mockRejectedValueOnce(new Error('accounts: timeout'))
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
  })
})

describe('POST /api/cb/marca — o que é recusado (400), antes de qualquer escrita', () => {
  const casos: [string, [string, string | File][], { erro: string; peca?: string }][] = [
    ['nome faltando', [['simbolo', simbolo()]], { erro: 'nome_obrigatorio' }],
    ['nome só com espaços', [['nome', '   '], ['simbolo', simbolo()]], { erro: 'nome_obrigatorio' }],
    ['nome com 61 caracteres', [['nome', 'a'.repeat(61)], ['simbolo', simbolo()]], { erro: 'nome_longo' }],
    ['nome curto com 21', [['nome', 'Nova'], ['nome_curto', 'b'.repeat(21)], ['simbolo', simbolo()]], { erro: 'nome_curto_longo' }],
    ['cor sem #', [['nome', 'Nova'], ['cor_do_icone', '112233'], ['simbolo', simbolo()]], { erro: 'cor_invalida' }],
    ['cor curta', [['nome', 'Nova'], ['cor_do_icone', '#123'], ['simbolo', simbolo()]], { erro: 'cor_invalida' }],
    ['remover peça que não existe', [['nome', 'Nova'], ['remover', 'logo']], { erro: 'peca_desconhecida', peca: 'logo' }],
    [
      'arquivo com o nome da peça em camelCase',
      [['nome', 'Nova'], ['simbolo', simbolo()], ['horizontalEscuro', arquivo(png(600, 100), 'h.png', 'image/png')]],
      { erro: 'peca_desconhecida', peca: 'horizontalEscuro' },
    ],
    [
      'símbolo em WebP',
      [['nome', 'Nova'], ['simbolo', arquivo(new Uint8Array([...Buffer.from('RIFF0000WEBP')]), 's.webp', 'image/webp')]],
      { erro: 'tipo_nao_aceito', peca: 'simbolo' },
    ],
    ['peça mandada como texto', [['nome', 'Nova'], ['simbolo', 'https://exemplo.test/logo.png']], { erro: 'tipo_nao_aceito', peca: 'simbolo' }],
    [
      'arquivo acima de 1 MB',
      [['nome', 'Nova'], ['simbolo', simbolo()], ['horizontal_claro', arquivo(new Uint8Array(TETO_DE_BYTES_DA_MARCA + 1), 'h.png', 'image/png')]],
      { erro: 'arquivo_grande', peca: 'horizontal_claro' },
    ],
    [
      '"PNG" que não é PNG',
      [['nome', 'Nova'], ['simbolo', simbolo()], ['horizontal_escuro', arquivo(new Uint8Array(40).fill(7), 'h.png', 'image/png')]],
      { erro: 'arquivo_corrompido', peca: 'horizontal_escuro' },
    ],
    [
      'SVG com script',
      [
        ['nome', 'Nova'],
        ['simbolo', simbolo()],
        ['vertical_claro', arquivo(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'v.svg', 'image/svg+xml')],
      ],
      { erro: 'svg_inseguro', peca: 'vertical_claro' },
    ],
    ['símbolo pequeno', [['nome', 'Nova'], ['simbolo', arquivo(png(100, 100), 's.png', 'image/png')]], { erro: 'simbolo_pequeno', peca: 'simbolo' }],
    ['símbolo grande demais', [['nome', 'Nova'], ['simbolo', arquivo(png(2049, 2049), 's.png', 'image/png')]], { erro: 'simbolo_grande', peca: 'simbolo' }],
    ['símbolo largo', [['nome', 'Nova'], ['simbolo', arquivo(png(600, 200), 's.png', 'image/png')]], { erro: 'simbolo_nao_quadrado', peca: 'simbolo' }],
    ['marca nova sem símbolo', [['nome', 'Nova']], { erro: 'simbolo_obrigatorio', peca: 'simbolo' }],
  ]
  for (const [caso, campos, esperado] of casos) {
    it(caso, async () => {
      const r = await POST(pedido(campos))
      expect(await respostaDe(r)).toEqual({ status: 400, corpo: esperado })
      expect(upload).not.toHaveBeenCalled()
      expect(banco.gravacoes).toEqual([])
      expect(revalidateTag).not.toHaveBeenCalled()
    })
  }

  it('remover o símbolo, a única peça obrigatória, sem mandar outro: simbolo_obrigatorio', async () => {
    banco.linha = { ...LINHA_ATUAL }
    const r = await POST(pedido([['nome', 'Marca Antiga'], ['remover', 'simbolo']]))
    expect(await respostaDe(r)).toEqual({ status: 400, corpo: { erro: 'simbolo_obrigatorio', peca: 'simbolo' } })
    expect(banco.gravacoes).toEqual([])
    expect(remove).not.toHaveBeenCalled()
  })

  it('corpo que não é multipart: 400 corpo_invalido', async () => {
    const r = await POST(new Request('http://crm.test/api/cb/marca', { method: 'POST', body: '{"nome":"x"}', headers: { 'content-type': 'application/json' } }))
    expect(await respostaDe(r)).toEqual({ status: 400, corpo: { erro: 'corpo_invalido' } })
  })

  it('o limite do nome conta como o banco (ponto de código): 60 emojis passam', async () => {
    const r = await POST(pedido([['nome', '😀'.repeat(60)], ['simbolo', simbolo()]]))
    expect(r.status).toBe(200)
  })
})

describe('POST /api/cb/marca — gravar', () => {
  it('caminho feliz: sobe com nome único, grava SÓ o que mudou, revalida e só então apaga o substituído', async () => {
    banco.linha = { ...LINHA_ATUAL }
    const r = await POST(
      pedido([
        ['nome', '  Marca Nova  '],
        ['simbolo', arquivo(png(512, 512), 'qualquer-nome.png', 'image/png; charset=binary')],
        ['remover', 'horizontal_claro'],
      ]),
    )
    const { status, corpo } = await respostaDe(r)
    expect(status).toBe(200)

    // Upload: caminho `<peca>/<uuid>.<ext>`, tipo normalizado, cache de um ano, sem sobrescrever.
    expect(upload).toHaveBeenCalledTimes(1)
    const [caminho, bytes, opcoes] = upload.mock.calls[0]!
    expect(caminho).toMatch(/^simbolo\/[0-9a-f-]{36}\.png$/)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(opcoes).toEqual({ contentType: 'image/png', cacheControl: '31536000', upsert: false })

    // Gravação parcial: nome aparado, símbolo novo, horizontal clara limpa; o que não foi tocado não vai.
    expect(banco.gravacoes).toHaveLength(1)
    const gravado = banco.gravacoes[0]!
    expect(gravado).toMatchObject({
      id: true,
      nome: 'Marca Nova',
      simbolo_path: caminho,
      horizontal_claro_path: null,
      atualizado_por: 'usuario-1',
    })
    expect(Number.isNaN(Date.parse(gravado.atualizado_em as string))).toBe(false)
    for (const intocada of ['nome_curto', 'cor_do_icone', 'horizontal_escuro_path', 'vertical_escuro_path', 'vertical_claro_path']) {
      expect(gravado).not.toHaveProperty(intocada)
    }

    // Revalida ANTES de apagar os antigos; apaga só o substituído e o removido.
    expect(revalidateTag).toHaveBeenCalledWith('marca', { expire: 0 })
    expect(remove).toHaveBeenCalledTimes(1)
    expect([...remove.mock.calls[0]![0]].sort()).toEqual(['horizontal-claro/antigo.png', 'simbolo/antigo.png'])
    expect(revalidateTag.mock.invocationCallOrder[0]!).toBeLessThan(remove.mock.invocationCallOrder[0]!)

    // A resposta é o corpo do GET, com a linha gravada.
    expect(corpo).toMatchObject({ podeEditar: true, motivo: null })
    expect(corpo.linha).toMatchObject({ nome: 'Marca Nova', simbolo_path: caminho, horizontal_escuro_path: 'horizontal-escuro/antigo.svg', horizontal_claro_path: null })
    expect(corpo.marca).toMatchObject({
      propria: true,
      nome: 'Marca Nova',
      nomeCurto: 'Antiga',
      simbolo: `https://storage.test/marca/${caminho}`,
      horizontalClaro: null,
    })
  })

  it('marca nova: cada peça na sua pasta em kebab-case, com a extensão do tipo', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1"/></svg>')
    const r = await POST(
      pedido([
        ['nome', 'Nova'],
        ['nome_curto', 'N'],
        ['cor_do_icone', '#0A0B0C'],
        ['simbolo', simbolo()],
        ['horizontal_escuro', arquivo(svg, 'h.svg', 'image/svg+xml')],
        ['vertical_claro', arquivo(new Uint8Array([...Buffer.from('RIFF0000WEBPVP8 ')]), 'v.webp', 'image/webp')],
      ]),
    )
    expect(r.status).toBe(200)
    const caminhos = upload.mock.calls.map((c) => c[0] as string)
    expect(caminhos).toHaveLength(3)
    expect(caminhos[0]).toMatch(/^simbolo\/.+\.png$/)
    expect(caminhos[1]).toMatch(/^horizontal-escuro\/.+\.svg$/)
    expect(caminhos[2]).toMatch(/^vertical-claro\/.+\.webp$/)
    expect(banco.gravacoes[0]).toMatchObject({ nome_curto: 'N', cor_do_icone: '#0A0B0C' })
    expect(remove).not.toHaveBeenCalled()
  })

  it('nome curto e cor VAZIOS limpam; peça com campo de arquivo em branco fica', async () => {
    banco.linha = { ...LINHA_ATUAL }
    // Como o NAVEGADOR manda um <input type="file"> deixado em branco
    // (`filename=""`, corpo vazio) — o FormData do Node manda sem
    // `filename`, e o campo chegaria como texto vazio (o outro caso, abaixo).
    const corpo = [
      '--X', 'Content-Disposition: form-data; name="nome"', '', 'Marca Antiga',
      '--X', 'Content-Disposition: form-data; name="nome_curto"', '', '',
      '--X', 'Content-Disposition: form-data; name="cor_do_icone"', '', ' ',
      '--X', 'Content-Disposition: form-data; name="horizontal_escuro"; filename=""', 'Content-Type: application/octet-stream', '', '',
      '--X', 'Content-Disposition: form-data; name="vertical_claro"', '', '',
      '--X--', '',
    ].join('\r\n')
    const r = await POST(
      new Request('http://crm.test/api/cb/marca', {
        method: 'POST',
        body: corpo,
        headers: { 'content-type': 'multipart/form-data; boundary=X' },
      }),
    )
    expect(r.status).toBe(200)
    expect(upload).not.toHaveBeenCalled()
    expect(banco.gravacoes[0]).toMatchObject({ nome_curto: null, cor_do_icone: null })
    expect(banco.gravacoes[0]).not.toHaveProperty('horizontal_escuro_path')
    expect(banco.gravacoes[0]).not.toHaveProperty('vertical_claro_path')
    expect(banco.linha).toMatchObject({ horizontal_escuro_path: 'horizontal-escuro/antigo.svg' })
    expect(remove).not.toHaveBeenCalled()
  })

  it('arquivo novo E "remover" na mesma peça: vale o arquivo (substitui)', async () => {
    banco.linha = { ...LINHA_ATUAL }
    const r = await POST(pedido([['nome', 'X'], ['simbolo', simbolo()], ['remover', 'simbolo']]))
    expect(r.status).toBe(200)
    expect(banco.gravacoes[0]!.simbolo_path).toMatch(/^simbolo\//)
    expect(remove.mock.calls[0]![0]).toEqual(['simbolo/antigo.png'])
  })

  it('gravação RECUSADA (4xx): apaga o que ESTE pedido subiu, não toca nos antigos, não revalida', async () => {
    banco.linha = { ...LINHA_ATUAL }
    banco.erroNaGravacao = { message: 'violates check constraint' }
    banco.statusNaGravacao = 400
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
    const subido = upload.mock.calls[0]![0]
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove.mock.calls[0]![0]).toEqual([subido])
    expect(banco.linha!.simbolo_path).toBe('simbolo/antigo.png')
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('gravação INCERTA (erro na resposta, linha gravada): o arquivo que a linha aponta fica', async () => {
    banco.linha = { ...LINHA_ATUAL }
    banco.erroNaGravacao = { message: 'timeout' }
    banco.gravaEFalha = true
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(r.status).toBe(500)
    expect(banco.linha!.simbolo_path).toBe(upload.mock.calls[0]![0])
    expect(remove).not.toHaveBeenCalled()
  })

  // Codex no #420: o 504 pode chegar ANTES do commit, e uma releitura ali
  // ainda vê a linha antiga — apagar o upload deixaria a linha (quando o
  // commit vier) apontando para arquivo apagado. Incerto não apaga nada.
  it('gravação INCERTA (504) que ainda não aparece no banco: os arquivos novos ficam', async () => {
    banco.linha = { ...LINHA_ATUAL }
    banco.erroNaGravacao = { message: 'Gateway Timeout' }
    banco.statusNaGravacao = 504
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
    expect(upload).toHaveBeenCalledTimes(1)
    expect(remove).not.toHaveBeenCalled()
  })

  it('rede caiu no upsert (exceção): os arquivos novos ficam', async () => {
    banco.linha = { ...LINHA_ATUAL }
    banco.lancaNaGravacao = true
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
    expect(remove).not.toHaveBeenCalled()
  })

  it('falha no upload: 500 falha_no_storage, desfaz o que subiu, não grava', async () => {
    banco.erroNoUpload = { message: 'Payload too large' }
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 500, corpo: { erro: 'falha_no_storage' } })
    expect(remove.mock.calls[0]![0]).toEqual([upload.mock.calls[0]![0]])
    expect(banco.gravacoes).toEqual([])
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('erro ao ler a marca atual: 500 falha_no_banco, nada sobe', async () => {
    banco.erroNaLeitura = { message: 'timeout' }
    const r = await POST(pedido([['nome', 'Nova'], ['simbolo', simbolo()]]))
    expect(await respostaDe(r)).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
    expect(upload).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/cb/marca — voltar ao padrão', () => {
  it('apaga a linha, revalida e apaga os arquivos DELA; responde o padrão', async () => {
    banco.linha = { ...LINHA_ATUAL }
    const { status, corpo } = await respostaDe(await DELETE())
    expect(status).toBe(200)
    expect(banco.linha).toBeNull()
    expect(revalidateTag).toHaveBeenCalledWith('marca', { expire: 0 })
    expect([...remove.mock.calls[0]![0]].sort()).toEqual([
      'horizontal-claro/antigo.png',
      'horizontal-escuro/antigo.svg',
      'simbolo/antigo.png',
    ])
    expect(corpo).toMatchObject({ linha: null, podeEditar: true, motivo: null })
    expect(corpo.marca).toMatchObject({ propria: false, nome: 'Atlas CRM' })
  })

  it('sem marca própria: 200, nada a apagar no bucket', async () => {
    const r = await DELETE()
    expect(r.status).toBe(200)
    expect(remove).not.toHaveBeenCalled()
  })

  it('erro ao apagar a linha: 500, os arquivos ficam, nada revalida', async () => {
    banco.linha = { ...LINHA_ATUAL }
    banco.erroNoDelete = { message: 'timeout' }
    expect(await respostaDe(await DELETE())).toEqual({ status: 500, corpo: { erro: 'falha_no_banco' } })
    expect(remove).not.toHaveBeenCalled()
    expect(revalidateTag).not.toHaveBeenCalled()
  })

  it('não-admin e admin de conta avulsa: 403, nada apagado', async () => {
    banco.linha = { ...LINHA_ATUAL }
    sessao.papel = 'viewer'
    expect((await DELETE()).status).toBe(403)
    sessao.papel = 'admin'
    sessao.conta = 'conta-avulsa'
    expect(await respostaDe(await DELETE())).toEqual({ status: 403, corpo: { erro: 'nao_e_a_conta_da_instalacao' } })
    expect(banco.linha).not.toBeNull()
  })
})

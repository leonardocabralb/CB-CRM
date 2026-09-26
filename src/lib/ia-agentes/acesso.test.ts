import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// O que o agente VÊ além da conversa (F3, plano 5.5). O que estes testes
// seguram:
//  - nada marcado = nada lido e nada no pedido (fechado por padrão);
//  - só o MARCADO é lido, sempre com a conta (o cliente é o de serviço);
//  - bloco que não se lê diz "unavailable right now" — nunca inventa, e as
//    cobranças nunca dizem "no overdue installments" sem a leitura;
//  - reagendar cancela o agendamento antigo: a próxima reunião é a que NÃO
//    tem `invitee.canceled`;
//  - o teto por bloco (truncamento declarado) e o do retrato.
// ============================================================

vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChaveDeEmbeddings: vi.fn(async () => ({ chave: null, ilegivel: false, recusada: false })),
}))

import { lerChaveDeEmbeddings } from '@/lib/ia-chaves/repo'

import {
  lerDadosDoAcesso,
  lerOQueOAgenteVe,
  lerRetrato,
  limitarBloco,
  montarBlocos,
  montarRetrato,
  TETO_DO_BLOCO,
  TETO_DO_RETRATO,
  type CobrancasLidas,
  type DadosDoAcesso,
} from './acesso'
import type { AcessoDoAgente } from './agente'
import type { ParcelaDoEspelho } from '@/lib/asaas/inadimplencia'

const AGORA = new Date('2026-09-26T15:00:00Z') // 12:00 em São Paulo
const FECHADO: AcessoDoAgente = { ficha: false, campos: [], negocio: false, etiquetas: false, cobrancas: false, reuniao: false }
const TUDO: AcessoDoAgente = {
  ficha: true,
  campos: ['cf-2', 'cf-1', 'cf-outra-conta'],
  negocio: true,
  etiquetas: true,
  cobrancas: true,
  reuniao: true,
}

function parcela(p: Partial<ParcelaDoEspelho> = {}): ParcelaDoEspelho {
  return {
    id: 'p1',
    asaas_payment_id: 'pay_1',
    asaas_customer_id: 'cus_1',
    status: 'OVERDUE',
    deleted: false,
    valor: 500,
    juros_e_multa: 12.5,
    vencimento: '2026-09-16',
    vencimento_original: null,
    vista_vencida_em: null,
    pago_em: null,
    forma: 'BOLETO',
    pode_pagar_apos_vencimento: true,
    dias_ate_cancelar_registro: null,
    descricao: null,
    parcelamento_id: 'inst_1',
    parcela_numero: 3,
    parcela_total: 12,
    link_fatura: 'https://www.asaas.com/i/x',
    link_boleto: null,
    visto_em: '2026-09-26T14:50:00Z',
    ...p,
  }
}

function cobrancas(p: Partial<Extract<CobrancasLidas, { conectado: true }>> = {}): CobrancasLidas {
  return {
    conectado: true,
    fresca: true,
    atualizadoEm: '2026-09-26T14:45:00Z',
    cicloCompleto: true,
    clientes: 1,
    resumo: {
      vencidas: [parcela()],
      emConferencia: [],
      negativada: false,
      total: 500,
      totalAtualizado: 512.5,
      desde: '2026-09-16',
      dias: 10,
    },
    ...p,
  }
}

const texto = (dados: DadosDoAcesso, acesso: AcessoDoAgente = TUDO) =>
  montarBlocos(dados, acesso, AGORA)
    .map((b) => b.texto)
    .join('\n\n')

// ------------------------------------------------------------
// montarBlocos (puro)
// ------------------------------------------------------------

describe('montarBlocos', () => {
  const dados: DadosDoAcesso = {
    ficha: { ok: true, valor: { nome: 'Maria\nSilva', telefone: '5511999990000', email: null, empresa: 'ACME' } },
    campos: { ok: true, valor: [{ nome: 'Processo', valor: '0001234-55' }, { nome: 'Vazio', valor: '  ' }] },
    negocio: { ok: true, valor: { funil: 'Comercial', etapa: 'Proposta', valor: 3500, etapaDesde: '2026-09-20T12:00:00Z' } },
    etiquetas: { ok: true, valor: ['bancário', 'vip'] },
    cobrancas: { ok: true, valor: cobrancas() },
    reuniao: {
      ok: true,
      valor: { inicio: '2026-09-30T17:00:00Z', evento: 'Consulta', remarcar: 'https://calendly.com/reschedulings/abc' },
    },
  }

  it('nada marcado = nenhum bloco, mesmo com dados', () => {
    expect(montarBlocos(dados, FECHADO, AGORA)).toEqual([])
  })

  it('marcado sem leitura (sem contato) não entra', () => {
    expect(montarBlocos({}, TUDO, AGORA)).toEqual([])
  })

  it('só os marcados, na ordem fixa dos blocos', () => {
    const blocos = montarBlocos(dados, { ...FECHADO, reuniao: true, ficha: true }, AGORA)
    expect(blocos.map((b) => b.bloco)).toEqual(['ficha', 'reuniao'])
  })

  it('ficha: uma linha por dado presente; nada = "no details"', () => {
    const t = texto(dados, { ...FECHADO, ficha: true })
    expect(t).toContain('- Name: Maria Silva')
    expect(t).toContain('- Phone: 5511999990000')
    expect(t).toContain('- Company: ACME')
    expect(t).not.toContain('Email')
    expect(texto({ ficha: { ok: true, valor: { nome: null, telefone: null, email: null, empresa: null } } }, TUDO)).toBe(
      'Customer record: no details on file.',
    )
  })

  it('campos: os preenchidos, na ordem recebida; nenhum = "none filled in"', () => {
    const t = texto(dados, { ...FECHADO, campos: ['x'] })
    expect(t).toBe('Custom fields:\n- Processo: 0001234-55')
    expect(texto({ campos: { ok: true, valor: [] } }, { ...FECHADO, campos: ['x'] })).toBe('Custom fields: none filled in.')
  })

  it('negócio: funil, etapa, valor e há quanto tempo na etapa; sem card, diz isso', () => {
    const t = texto(dados, { ...FECHADO, negocio: true })
    expect(t).toContain('- Pipeline: Comercial')
    expect(t).toContain('- Stage: Proposta')
    expect(t).toContain('3.500,00')
    expect(t).toContain('- In this stage since: 20 September 2026 (6 days)')
    expect(texto({ negocio: { ok: true, valor: null } }, TUDO)).toBe('Deal: this customer has no open deal.')
  })

  it('negócio com valor ZERO não inventa "R$ 0,00" (é o DEFAULT, não um valor)', () => {
    const t = texto({ negocio: { ok: true, valor: { funil: 'F', etapa: 'E', valor: 0, etapaDesde: null } } }, TUDO)
    expect(t).not.toContain('Value')
    expect(t).not.toContain('since')
  })

  it('etiquetas', () => {
    expect(texto(dados, { ...FECHADO, etiquetas: true })).toBe('Tags: bancário, vip')
    expect(texto({ etiquetas: { ok: true, valor: [] } }, TUDO)).toBe('Tags: none.')
  })

  it('cobranças: as DEVIDAS, com vencimento, valor com juros, dias e o total', () => {
    const t = texto({ cobrancas: { ok: true, valor: cobrancas() } }, TUDO)
    expect(t).toContain('Billing (Asaas) — overdue installments:')
    expect(t).toMatch(/- installment 3\/12 — due 2026-09-16 — R\$\s512,50, 10 days overdue/)
    expect(t).toMatch(/Total overdue: R\$\s512,50/)
    expect(t).not.toContain('outdated')
  })

  it('cobranças: leitura VELHA diz a data e que pode estar desatualizada', () => {
    const t = texto({ cobrancas: { ok: true, valor: cobrancas({ fresca: false }) } }, TUDO)
    expect(t).toContain('Data as of 26 September 2026, may be outdated.')
  })

  it('cobranças: negativada e parcelas "em conferência" (podem ter sido pagas) ditas como tal', () => {
    const c = cobrancas()
    if (!c.conectado) throw new Error('fixture')
    c.resumo = { ...c.resumo, vencidas: [parcela({ status: 'DUNNING_REQUESTED' })], emConferencia: [parcela({ id: 'p2' })] }
    const t = texto({ cobrancas: { ok: true, valor: c } }, TUDO)
    expect(t).toContain('sent to the credit bureau')
    expect(t).toContain('1 other installment is being re-checked and may already be paid — do not treat them as owed.')
  })

  it('cobranças: sem parcela devida, com a leitura, "no overdue installments"', () => {
    const c = cobrancas()
    if (!c.conectado) throw new Error('fixture')
    c.resumo = { ...c.resumo, vencidas: [], total: 0, totalAtualizado: 0, desde: null, dias: null }
    expect(texto({ cobrancas: { ok: true, valor: c } }, TUDO)).toBe('Billing (Asaas): no overdue installments.')
  })

  it('⚠️ cobranças: NUNCA "sem dívida" sem a leitura', () => {
    // Asaas desconectado: o bloco diz isso, não "em dia".
    expect(texto({ cobrancas: { ok: true, valor: { conectado: false } } }, TUDO)).toMatch(/not connected/)
    // Nenhuma listagem completa ainda.
    expect(texto({ cobrancas: { ok: true, valor: cobrancas({ atualizadoEm: null }) } }, TUDO)).toBe(
      'Billing (Asaas): unavailable right now.',
    )
    // Nenhum cliente ligado com o vínculo da listagem ainda por terminar: lacuna.
    expect(texto({ cobrancas: { ok: true, valor: cobrancas({ clientes: 0, cicloCompleto: false }) } }, TUDO)).toBe(
      'Billing (Asaas): unavailable right now.',
    )
    // Com o ciclo completo, "nenhum cliente ligado" é resposta.
    expect(texto({ cobrancas: { ok: true, valor: cobrancas({ clientes: 0 }) } }, TUDO)).toBe(
      'Billing (Asaas): no billing record is linked to this customer.',
    )
    // A leitura que falhou.
    expect(texto({ cobrancas: { ok: false } }, TUDO)).toBe('Billing (Asaas): unavailable right now.')
  })

  it('reunião: data e hora no fuso do escritório e o link de remarcar; sem reunião, diz isso', () => {
    const t = texto(dados, { ...FECHADO, reuniao: true })
    expect(t).toContain('Next meeting: Wednesday, 30 September 2026')
    expect(t).toContain('14:00') // 17:00 UTC
    expect(t).toContain('— Consulta')
    expect(t).toContain('- Reschedule link: https://calendly.com/reschedulings/abc')
    expect(texto({ reuniao: { ok: true, valor: null } }, TUDO)).toBe('Next meeting: none scheduled.')
  })

  it('leitura que falhou = "unavailable right now", bloco a bloco', () => {
    const blocos = montarBlocos({ ficha: { ok: false }, etiquetas: { ok: true, valor: ['x'] } }, TUDO, AGORA)
    expect(blocos).toEqual([
      { bloco: 'ficha', texto: 'Customer record: unavailable right now.' },
      { bloco: 'etiquetas', texto: 'Tags: x' },
    ])
  })

  it('teto por bloco, com o truncamento DECLARADO', () => {
    const muitas = Array.from({ length: 400 }, (_, i) => `etiqueta-${i}`)
    const [bloco] = montarBlocos({ etiquetas: { ok: true, valor: muitas } }, TUDO, AGORA)
    expect(bloco.texto.length).toBeLessThanOrEqual(TETO_DO_BLOCO)
    expect(bloco.texto.endsWith('[… truncated]')).toBe(true)
    expect(limitarBloco('curto')).toBe('curto')
  })
})

// ------------------------------------------------------------
// O retrato
// ------------------------------------------------------------

describe('montarRetrato / lerRetrato', () => {
  it('os blocos como entraram e os documentos dos trechos, sem repetição', () => {
    const r = montarRetrato(
      [{ bloco: 'ficha', texto: 'Customer record: no details on file.' }],
      [
        { id: 't1', documentoId: 'doc-1', content: 'a' },
        { id: 't2', documentoId: 'doc-2', content: 'b' },
        { id: 't3', documentoId: 'doc-1', content: 'c' },
      ],
    )
    expect(r).toEqual({ blocos: [{ bloco: 'ficha', texto: 'Customer record: no details on file.' }], documentos: ['doc-1', 'doc-2'] })
  })

  it('o pior caso dos blocos (todos no teto) cabe no teto do retrato', () => {
    const cheios = (['ficha', 'campos', 'negocio', 'etiquetas', 'cobrancas', 'reuniao'] as const).map((bloco) => ({
      bloco,
      texto: 'x'.repeat(TETO_DO_BLOCO),
    }))
    const trechos = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, documentoId: `doc-${i}`, content: 'y' }))
    const r = montarRetrato(cheios, trechos)
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(TETO_DO_RETRATO)
    expect(r.blocos.every((b) => b.texto.length === TETO_DO_BLOCO)).toBe(true)
  })

  it('texto fora do comum (o JSON escapa caractere de controle) é cortado até caber', () => {
    const r = montarRetrato(
      [{ bloco: 'campos', texto: '\u0001'.repeat(TETO_DO_BLOCO) }, { bloco: 'ficha', texto: '\u0002'.repeat(TETO_DO_BLOCO) }],
      [],
    )
    expect(JSON.stringify(r).length).toBeLessThanOrEqual(TETO_DO_RETRATO)
  })

  it('lerRetrato: parse, nunca `as`', () => {
    expect(lerRetrato(null)).toBeNull()
    expect(lerRetrato({ blocos: 'x', documentos: [] })).toBeNull()
    expect(lerRetrato({ blocos: [{ bloco: 'ficha', texto: 't' }, { bloco: 1 }], documentos: ['d', 2] })).toEqual({
      blocos: [{ bloco: 'ficha', texto: 't' }],
      documentos: ['d'],
    })
  })
})

// ------------------------------------------------------------
// A leitura (I/O) contra um banco falso
// ------------------------------------------------------------

type Linha = Record<string, unknown>
interface Consulta {
  tabela: string
  filtros: Array<[string, ...unknown[]]>
}

function criarBanco(tabelas: Record<string, Linha[]>, falhas: string[] = []) {
  const consultas: Consulta[] = []
  const from = (tabela: string) => {
    const c: Consulta = { tabela, filtros: [] }
    consultas.push(c)
    const executar = () => {
      if (falhas.includes(tabela)) return { data: null, error: { message: `${tabela} fora do ar` } }
      let linhas = [...(tabelas[tabela] ?? [])]
      for (const [m, col, v] of c.filtros) {
        const k = col as string
        if (m === 'eq') linhas = linhas.filter((l) => l[k] === v)
        if (m === 'in') linhas = linhas.filter((l) => (v as unknown[]).includes(l[k]))
        if (m === 'gt') linhas = linhas.filter((l) => String(l[k]) > String(v))
      }
      const ordem = c.filtros.find(([m]) => m === 'order')
      if (ordem) {
        const [, col, op] = ordem as [string, string, { ascending?: boolean }?]
        const s = op?.ascending === false ? -1 : 1
        linhas.sort((a, b) => (String(a[col]) < String(b[col]) ? -s : String(a[col]) > String(b[col]) ? s : 0))
      }
      const limite = c.filtros.find(([m]) => m === 'limit')
      if (limite) linhas = linhas.slice(0, limite[1] as number)
      const faixa = c.filtros.find(([m]) => m === 'range')
      if (faixa) linhas = linhas.slice(faixa[1] as number, (faixa[2] as number) + 1)
      return { data: linhas, error: null }
    }
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'gt', 'is', 'order', 'limit', 'range']) {
      q[m] = (...a: unknown[]) => {
        if (m !== 'select') c.filtros.push([m, ...a])
        return q
      }
    }
    q.maybeSingle = async () => {
      const r = executar()
      return r.error ? r : { data: (r.data as Linha[])[0] ?? null, error: null }
    }
    q.then = (ok: (r: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro)
    return q
  }
  return { db: { from, rpc: async () => ({ data: [], error: null }) } as unknown as SupabaseClient, consultas }
}

const CONTA = 'conta-1'
const CONTATO = 'contato-1'

function tabelasCompletas(): Record<string, Linha[]> {
  return {
    contacts: [
      { id: CONTATO, account_id: CONTA, name: 'Maria', phone: '5511999990000', email: 'm@x.com', company: null },
      { id: 'contato-2', account_id: 'outra', name: 'Outra', phone: '1', email: null, company: null },
    ],
    custom_fields: [
      { id: 'cf-1', account_id: CONTA, field_name: 'Processo' },
      { id: 'cf-2', account_id: CONTA, field_name: 'Dívida' },
      { id: 'cf-outra-conta', account_id: 'outra', field_name: 'Segredo' },
    ],
    contact_custom_values: [
      { contact_id: CONTATO, custom_field_id: 'cf-1', value: '0001234-55' },
      { contact_id: CONTATO, custom_field_id: 'cf-2', value: '200 mil' },
      { contact_id: CONTATO, custom_field_id: 'cf-outra-conta', value: 'não pode aparecer' },
    ],
    deals: [
      { id: 'd-velho', account_id: CONTA, contact_id: CONTATO, status: 'open', pipeline_id: 'f1', stage_id: 'e1', value: 100, etapa_desde: '2026-09-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
      { id: 'd-novo', account_id: CONTA, contact_id: CONTATO, status: 'open', pipeline_id: 'f1', stage_id: 'e2', value: 3500, etapa_desde: '2026-09-20T12:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      { id: 'd-ganho', account_id: CONTA, contact_id: CONTATO, status: 'won', pipeline_id: 'f1', stage_id: 'e3', value: 9, etapa_desde: null, created_at: '2026-09-25T00:00:00Z' },
    ],
    pipelines: [{ id: 'f1', account_id: CONTA, name: 'Comercial' }],
    pipeline_stages: [
      { id: 'e1', pipeline_id: 'f1', name: 'Lead' },
      { id: 'e2', pipeline_id: 'f1', name: 'Proposta' },
    ],
    contact_tags: [
      { contact_id: CONTATO, tag_id: 't1' },
      { contact_id: CONTATO, tag_id: 't2' },
    ],
    tags: [
      { id: 't1', account_id: CONTA, name: 'vip' },
      { id: 't2', account_id: CONTA, name: 'bancário' },
    ],
    cb_asaas_config: [
      { account_id: CONTA, status: 'conectado', vencidas_listadas_em: '2026-09-26T14:45:00Z', vinculo_completo_em: '2026-09-26T14:46:00Z' },
    ],
    cb_asaas_clientes: [{ id: 'cli-1', account_id: CONTA, contact_id: CONTATO, deleted: false, asaas_customer_id: 'cus_1', nome: 'Maria' }],
    cb_asaas_cobrancas: [
      { ...parcela(), account_id: CONTA },
      { ...parcela({ id: 'p-paga', status: 'RECEIVED' }), account_id: CONTA },
    ],
    cb_calendly_eventos: [
      // Reagendamento: o antigo (mais cedo) foi CANCELADO; o novo vale.
      { account_id: CONTA, contact_id: CONTATO, evento: 'invitee.created', invitee_uri: 'inv-antigo', inicio: '2026-09-28T13:00:00Z', event_type_nome: 'Consulta', variaveis: { agendamento_remarcar: 'https://c/antigo' } },
      { account_id: CONTA, evento: 'invitee.canceled', invitee_uri: 'inv-antigo', inicio: '2026-09-28T13:00:00Z' },
      { account_id: CONTA, contact_id: CONTATO, evento: 'invitee.created', invitee_uri: 'inv-novo', inicio: '2026-09-30T17:00:00Z', event_type_nome: 'Consulta', variaveis: { agendamento_remarcar: 'https://c/novo' } },
      // Passada: não é a próxima.
      { account_id: CONTA, contact_id: CONTATO, evento: 'invitee.created', invitee_uri: 'inv-passado', inicio: '2026-09-20T13:00:00Z', event_type_nome: 'Consulta', variaveis: {} },
    ],
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('lerDadosDoAcesso', () => {
  it('sem contato: nada é lido', async () => {
    const { db, consultas } = criarBanco(tabelasCompletas())
    expect(await lerDadosDoAcesso(db, { accountId: CONTA, contactId: null, dealId: null, acesso: TUDO, agora: AGORA })).toEqual({})
    expect(consultas).toEqual([])
  })

  it('nada marcado: nenhuma consulta', async () => {
    const { db, consultas } = criarBanco(tabelasCompletas())
    expect(await lerDadosDoAcesso(db, { accountId: CONTA, contactId: CONTATO, dealId: null, acesso: FECHADO, agora: AGORA })).toEqual({})
    expect(consultas).toEqual([])
  })

  it('só o marcado é lido', async () => {
    const { db, consultas } = criarBanco(tabelasCompletas())
    const dados = await lerDadosDoAcesso(db, {
      accountId: CONTA,
      contactId: CONTATO,
      dealId: null,
      acesso: { ...FECHADO, etiquetas: true },
      agora: AGORA,
    })
    expect(Object.keys(dados)).toEqual(['etiquetas'])
    expect([...new Set(consultas.map((c) => c.tabela))]).toEqual(['contact_tags', 'tags'])
  })

  it('tudo marcado: cada bloco com a CONTA, e o texto que o modelo vai ler', async () => {
    const { db, consultas } = criarBanco(tabelasCompletas())
    const dados = await lerDadosDoAcesso(db, { accountId: CONTA, contactId: CONTATO, dealId: null, acesso: TUDO, agora: AGORA })
    for (const tabela of ['contacts', 'custom_fields', 'deals', 'pipelines', 'tags', 'cb_asaas_config', 'cb_asaas_clientes', 'cb_asaas_cobrancas', 'cb_calendly_eventos']) {
      for (const c of consultas.filter((x) => x.tabela === tabela)) {
        expect(c.filtros, tabela).toContainEqual(['eq', 'account_id', CONTA])
      }
    }
    const t = texto(dados)
    expect(t).toContain('- Name: Maria')
    // Os campos na ordem MARCADA; o de outra conta some.
    expect(t).toContain('Custom fields:\n- Dívida: 200 mil\n- Processo: 0001234-55')
    expect(t).not.toContain('não pode aparecer')
    // O card ABERTO mais recente (o ganho não conta).
    expect(t).toContain('- Stage: Proposta')
    expect(t).toContain('Tags: bancário, vip')
    // Só as devidas: a paga não aparece.
    expect(t).toContain('installment 3/12')
    expect(t.match(/installment \d/g)).toHaveLength(1)
    // A reunião do reagendamento, não a cancelada.
    expect(t).toContain('Next meeting: Wednesday, 30 September 2026')
    expect(t).toContain('https://c/novo')
    expect(t).not.toContain('https://c/antigo')
  })

  it('o card do TURNO (dealId) em vez do mais recente', async () => {
    const { db } = criarBanco(tabelasCompletas())
    const dados = await lerDadosDoAcesso(db, {
      accountId: CONTA,
      contactId: CONTATO,
      dealId: 'd-velho',
      acesso: { ...FECHADO, negocio: true },
      agora: AGORA,
    })
    expect(texto(dados)).toContain('- Stage: Lead')
  })

  it('Asaas sem configuração: "não conectado", nunca "em dia"', async () => {
    const tabelas = tabelasCompletas()
    tabelas.cb_asaas_config = []
    const { db } = criarBanco(tabelas)
    const dados = await lerDadosDoAcesso(db, {
      accountId: CONTA,
      contactId: CONTATO,
      dealId: null,
      acesso: { ...FECHADO, cobrancas: true },
      agora: AGORA,
    })
    expect(dados.cobrancas).toEqual({ ok: true, valor: { conectado: false } })
  })

  it('todas as reuniões futuras canceladas = nenhuma marcada', async () => {
    const tabelas = tabelasCompletas()
    tabelas.cb_calendly_eventos.push({ account_id: CONTA, evento: 'invitee.canceled', invitee_uri: 'inv-novo' })
    const { db } = criarBanco(tabelas)
    const dados = await lerDadosDoAcesso(db, {
      accountId: CONTA,
      contactId: CONTATO,
      dealId: null,
      acesso: { ...FECHADO, reuniao: true },
      agora: AGORA,
    })
    expect(dados.reuniao).toEqual({ ok: true, valor: null })
  })

  it('⚠️ erro num bloco não derruba os outros: ele vai como indisponível', async () => {
    const { db } = criarBanco(tabelasCompletas(), ['cb_asaas_config', 'contact_tags'])
    const dados = await lerDadosDoAcesso(db, { accountId: CONTA, contactId: CONTATO, dealId: null, acesso: TUDO, agora: AGORA })
    expect(dados.cobrancas).toEqual({ ok: false })
    expect(dados.etiquetas).toEqual({ ok: false })
    expect(dados.ficha?.ok).toBe(true)
    const t = texto(dados)
    expect(t).toContain('Billing (Asaas): unavailable right now.')
    expect(t).toContain('Tags: unavailable right now.')
  })

  it('ficha sem telefone: os @ aparecem (a identidade da ficha só do Instagram)', async () => {
    const tabelas = tabelasCompletas()
    tabelas.contacts.push({ id: 'contato-ig', account_id: CONTA, name: null, phone: null, instagram_username: 'maria.s', email: null, company: null })
    const { db } = criarBanco(tabelas)
    const dados = await lerDadosDoAcesso(db, {
      accountId: CONTA,
      contactId: 'contato-ig',
      dealId: null,
      acesso: { ...FECHADO, ficha: true },
      agora: AGORA,
    })
    expect(texto(dados)).toBe('Customer record:\n- Instagram: @maria.s')
  })

  it('contato que não é da conta: a ficha não aparece (indisponível)', async () => {
    const { db } = criarBanco(tabelasCompletas())
    const dados = await lerDadosDoAcesso(db, {
      accountId: CONTA,
      contactId: 'contato-2',
      dealId: null,
      acesso: { ...FECHADO, ficha: true },
      agora: AGORA,
    })
    expect(dados.ficha).toEqual({ ok: false })
  })
})

describe('lerOQueOAgenteVe', () => {
  it('agente sem documento: a chave de embeddings nem é lida; o retrato traz os blocos', async () => {
    vi.mocked(lerChaveDeEmbeddings).mockClear()
    const { db } = criarBanco(tabelasCompletas())
    const visto = await lerOQueOAgenteVe(db, {
      accountId: CONTA,
      agente: { id: 'ag-1', acesso: { ...FECHADO, etiquetas: true } },
      contactId: CONTATO,
      dealId: null,
      consulta: 'qual o horário?',
      agora: AGORA,
    })
    expect(visto.trechos).toEqual([])
    expect(visto.blocos).toEqual([{ bloco: 'etiquetas', texto: 'Tags: bancário, vip' }])
    expect(visto.retrato).toEqual({ blocos: [{ bloco: 'etiquetas', texto: 'Tags: bancário, vip' }], documentos: [] })
    expect(lerChaveDeEmbeddings).not.toHaveBeenCalled()
  })
})

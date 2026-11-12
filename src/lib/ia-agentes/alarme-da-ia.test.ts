import type { SupabaseClient } from '@supabase/supabase-js'
import { createTranslator } from 'next-intl'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { AiError } from '@/lib/ai/types'

import pt from '../../../messages/pt-BR.json'

import {
  LEMBRAR_APOS_MIN,
  MOTIVOS_DA_FALHA_DA_IA,
  motivoDaFalhaDaIa,
  quandoNoEscritorio,
  quemAvisarDoAlarme,
  registrarFalhaDaIa,
  registrarIaVoltou,
  textosDoAlarme,
  titulosDoAlarme,
} from './alarme-da-ia'
import type { MembroAvisavel } from './aviso-da-transferencia'

// ============================================================
// O ALARME quando a IA para de responder (1140; decisões F1–F3 do operador,
// `docs/PLANO-alarme-quando-a-ia-para.md`): o motivo lido do erro do
// provedor, quem recebe, os textos e a gravação (abre, lembra, só conta,
// voltou). A decisão sob trava mora no banco (`cb_ia_registrar_falha`, pino
// em `supabase/migrations/alarme-da-ia-1140.test.ts`); aqui ela é dublada.
// ============================================================

beforeAll(() => {
  // O tradutor do servidor lê o idioma da instalação (o cache é do módulo).
  vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'pt-BR')
})

afterEach(() => {
  vi.restoreAllMocks()
})

const t = createTranslator({ locale: 'pt-BR', messages: pt, namespace: 'IaAgentes.alarme' }) as unknown as (
  chave: string,
  valores?: Record<string, string | number>,
) => string

describe('motivoDaFalhaDaIa — o que o erro do provedor diz', () => {
  const http = (code: string, upstreamStatus: number, detalhe: string) =>
    new AiError(`Provedor API error (${upstreamStatus}): ${detalhe}`, { code, upstreamStatus })

  it('créditos esgotados vêm ANTES do status: o 429 sem saldo não é "limite por minuto"', () => {
    // Anthropic: 400 com o saldo baixo; e o limite de gasto do console.
    expect(
      motivoDaFalhaDaIa(
        http('provider_error', 400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.'),
      ),
    ).toBe('creditos')
    expect(
      motivoDaFalhaDaIa(http('provider_error', 400, 'You have reached your specified API usage limits.')),
    ).toBe('creditos')
    // OpenAI: 429 `insufficient_quota`.
    expect(
      motivoDaFalhaDaIa(
        http('rate_limited', 429, 'You exceeded your current quota, please check your plan and billing details.'),
      ),
    ).toBe('creditos')
    // Gemini: créditos pré-pagos esgotados.
    expect(motivoDaFalhaDaIa(http('rate_limited', 429, 'Your prepayment credits are depleted.'))).toBe('creditos')
  })

  it('a chave recusada, o modelo que sumiu (404) e o provedor fora do ar (5xx, prazo)', () => {
    expect(motivoDaFalhaDaIa(new AiError('Gemini rejected the API key', { code: 'invalid_key', upstreamStatus: 403 }))).toBe(
      'chave_recusada',
    )
    expect(motivoDaFalhaDaIa(http('provider_error', 404, 'model not found'))).toBe('modelo')
    expect(motivoDaFalhaDaIa(http('provider_error', 503, 'overloaded'))).toBe('fora_do_ar')
    expect(motivoDaFalhaDaIa(new AiError('timed out', { code: 'timeout' }))).toBe('fora_do_ar')
  })

  it('o limite por minuto sem palavra de saldo, a resposta cortada e o resto', () => {
    expect(
      motivoDaFalhaDaIa(http('rate_limited', 429, 'Rate limit reached for requests per min (RPM): Limit 500')),
    ).toBe('limite_por_minuto')
    expect(motivoDaFalhaDaIa(new AiError('cut', { code: 'output_truncated' }))).toBe('cortada')
    expect(motivoDaFalhaDaIa(http('provider_error', 400, 'invalid request'))).toBe('outro')
    expect(motivoDaFalhaDaIa(new Error('qualquer'))).toBe('outro')
    expect(motivoDaFalhaDaIa('texto')).toBe('outro')
  })
})

describe('quemAvisarDoAlarme — F3 do operador', () => {
  const MEMBROS: MembroAvisavel[] = [
    { userId: 'dono', papel: 'owner', perfil: null },
    { userId: 'admin', papel: 'admin', perfil: null },
    { userId: 'ana-marcada', papel: 'agent', perfil: null },
    { userId: 'caio-marcado', papel: 'agent', perfil: null },
  ]

  it('o dono e os admins SEMPRE, e os marcados nos agentes daquele provedor, sem repetir', () => {
    expect(quemAvisarDoAlarme(MEMBROS, ['ana-marcada', 'admin', 'ana-marcada'])).toEqual(['dono', 'admin', 'ana-marcada'])
    expect(quemAvisarDoAlarme(MEMBROS, [])).toEqual(['dono', 'admin'])
  })

  it('marcado que saiu (fora da lista de membros ativos) não recebe', () => {
    expect(quemAvisarDoAlarme(MEMBROS, ['saiu', 'caio-marcado'])).toEqual(['dono', 'admin', 'caio-marcado'])
  })
})

describe('quandoNoEscritorio — a hora no fuso do escritório', () => {
  const agora = new Date('2026-11-12T15:00:00Z') // 12:00 em Brasília

  it('no mesmo dia, só a hora', () => {
    expect(quandoNoEscritorio(new Date('2026-11-12T13:05:00Z'), agora)).toBe('10:05')
  })

  it('noutro dia, dia e hora — o dia é o do ESCRITÓRIO, não o do servidor (UTC)', () => {
    // 02:00 UTC do dia 12 ainda é 23:00 do dia 11 em Brasília.
    expect(quandoNoEscritorio(new Date('2026-11-12T02:00:00Z'), agora)).toBe('11/11 23:00')
  })
})

describe('textosDoAlarme — o que o sino e a caixinha dizem', () => {
  const agora = new Date('2026-11-12T15:00:00Z')
  const desde = new Date('2026-11-12T13:05:00Z')

  it('o alarme: o provedor no título, o motivo (com o conserto) e desde quando no corpo', () => {
    expect(
      textosDoAlarme(t, { tipo: 'abriu', provedor: 'anthropic', motivo: 'creditos', desde, falhas: 1, agora }),
    ).toEqual({
      titulo: 'A IA parou de responder (Anthropic)',
      corpo:
        'Créditos ou cota de Anthropic esgotados (ou limite de gasto atingido): confira o saldo no painel do provedor. ' +
        'Parada desde 10:05 · 1 resposta não saiu.',
    })
  })

  it('o lembrete conta as respostas que não saíram', () => {
    const { titulo, corpo } = textosDoAlarme(t, {
      tipo: 'continua',
      provedor: 'gemini',
      motivo: 'chave_recusada',
      desde,
      falhas: 7,
      agora,
    })
    expect(titulo).toBe('A IA continua parada (Gemini)')
    expect(corpo).toBe('Gemini recusou a chave: troque-a em Integrações. Parada desde 10:05 · 7 respostas não saíram.')
  })

  it('o "voltou" diz de quando a quando e manda conferir as conversas em atraso', () => {
    expect(textosDoAlarme(t, { tipo: 'voltou', provedor: 'openai', desde, falhas: 3, agora })).toEqual({
      titulo: 'A IA voltou a responder (OpenAI)',
      corpo: 'Parada de 10:05 a 12:00 · 3 respostas não saíram. Confira as conversas em atraso.',
    })
  })

  it('todo motivo tem texto (chave montada)', () => {
    for (const motivo of MOTIVOS_DA_FALHA_DA_IA) {
      const { corpo } = textosDoAlarme(t, { tipo: 'abriu', provedor: 'openai', motivo, desde, falhas: 1, agora })
      expect(corpo).not.toContain('IaAgentes.alarme')
      expect(corpo).toContain('OpenAI')
    }
  })

  it('os títulos do provedor (o que abriu e o lembrete) são os que a gravação usa', () => {
    expect(titulosDoAlarme(t, 'gemini')).toEqual(['A IA parou de responder (Gemini)', 'A IA continua parada (Gemini)'])
  })
})

// ------------------------------------------------------------
// A gravação, com o banco dublado
// ------------------------------------------------------------

type Op = 'select' | 'update' | 'insert'
interface Chamada {
  tabela: string
  op: Op
  filtros: Array<[string, string, unknown]>
  valores?: unknown
}

function bancoFalso(opcoes: {
  rpc?: { data?: unknown; error?: { message: string } | null }
  fechado?: { desde: string; falhas: number } | null
  marcados?: string[][]
  erroNoInsert?: boolean
  /** O episódio relido DEPOIS de gravar o alarme (padrão: o mesmo, aberto). */
  episodioDepois?: { desde: string; normalizou_em: string | null } | null
}) {
  const chamadas: Chamada[] = []
  const rpcs: Array<{ nome: string; args: unknown }> = []
  const responder = (c: Chamada) => {
    if (c.tabela === 'profiles') {
      return {
        data: [
          { user_id: 'dono', account_role: 'owner', perfil_id: null },
          { user_id: 'ana-marcada', account_role: 'agent', perfil_id: null },
          { user_id: 'bia', account_role: 'agent', perfil_id: null },
        ],
        error: null,
      }
    }
    if (c.tabela === 'cb_perfis_de_acesso') return { data: [], error: null }
    if (c.tabela === 'cb_ia_agentes') {
      return { data: (opcoes.marcados ?? [['ana-marcada']]).map((ids) => ({ avisar_ao_transferir: ids })), error: null }
    }
    if (c.tabela === 'cb_ia_alarmes' && c.op === 'update') {
      return { data: opcoes.fechado ? [opcoes.fechado] : [], error: null }
    }
    if (c.tabela === 'cb_ia_alarmes' && c.op === 'select') {
      const daRpc = (opcoes.rpc?.data ?? {}) as { desde?: string }
      const ep = opcoes.episodioDepois === undefined ? { desde: daRpc.desde, normalizou_em: null } : opcoes.episodioDepois
      return { data: ep, error: null }
    }
    if (c.tabela === 'notifications' && c.op === 'insert') {
      if (opcoes.erroNoInsert) return { data: null, error: { message: 'violates check constraint' } }
      return { data: (c.valores as object[]).map((_, i) => ({ id: `aviso-${i + 1}` })), error: null }
    }
    return { data: null, error: null }
  }
  const db = {
    rpc: async (nome: string, args: unknown) => {
      rpcs.push({ nome, args })
      return { data: opcoes.rpc?.data ?? null, error: opcoes.rpc?.error ?? null }
    },
    from: (tabela: string) => {
      const c: Chamada = { tabela, op: 'select', filtros: [] }
      chamadas.push(c)
      const q = {
        select: () => q,
        update: (v: unknown) => ((c.op = 'update'), (c.valores = v), q),
        insert: (v: unknown) => ((c.op = 'insert'), (c.valores = v), q),
        eq: (k: string, v: unknown) => (c.filtros.push(['eq', k, v]), q),
        is: (k: string, v: unknown) => (c.filtros.push(['is', k, v]), q),
        in: (k: string, v: unknown) => (c.filtros.push(['in', k, v]), q),
        gte: (k: string, v: unknown) => (c.filtros.push(['gte', k, v]), q),
        maybeSingle: () => q,
        then: (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) =>
          Promise.resolve(responder(c)).then(ok, falha),
      }
      return q
    },
  }
  return { db: db as unknown as SupabaseClient, chamadas, rpcs }
}

const inseridos = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.tabela === 'notifications' && c.op === 'insert').flatMap((c) => c.valores as object[])
const aposentadorias = (chamadas: Chamada[]) =>
  chamadas.filter((c) => c.tabela === 'notifications' && c.op === 'update')

describe('registrarFalhaDaIa — abre, lembra ou só conta', () => {
  const ARGS = { accountId: 'conta-1', provedor: 'anthropic', motivo: 'creditos' as const }

  it('pergunta ao banco com o lembrete de 6 h (F1)', async () => {
    const { db, rpcs } = bancoFalso({ rpc: { data: { acao: 'nada' } } })
    await registrarFalhaDaIa(db, ARGS)
    expect(LEMBRAR_APOS_MIN).toBe(360)
    expect(rpcs).toEqual([
      {
        nome: 'cb_ia_registrar_falha',
        args: { p_conta: 'conta-1', p_provedor: 'anthropic', p_motivo: 'creditos', p_lembrar_apos_min: 360 },
      },
    ])
  })

  it('"nada" (o episódio já avisado há menos de 6 h): nenhum aviso — UM alarme por problema', async () => {
    const { db, chamadas } = bancoFalso({ rpc: { data: { acao: 'nada', desde: '2026-11-12T13:05:00Z', falhas: 4 } } })
    await registrarFalhaDaIa(db, ARGS)
    expect(inseridos(chamadas)).toEqual([])
  })

  it('"abriu": `ia_falhou` para o dono, os admins e os marcados ativos, sem conversa', async () => {
    const { db, chamadas } = bancoFalso({
      rpc: { data: { acao: 'abriu', desde: '2026-11-12T13:05:00Z', falhas: 1 } },
      marcados: [['ana-marcada', 'saiu'], ['ana-marcada']],
    })
    await registrarFalhaDaIa(db, ARGS)
    const avisos = inseridos(chamadas) as Array<Record<string, unknown>>
    expect(avisos.map((a) => a.user_id)).toEqual(['dono', 'ana-marcada'])
    for (const a of avisos) {
      expect(a).toMatchObject({
        account_id: 'conta-1',
        type: 'ia_falhou',
        conversation_id: null,
        contact_id: null,
        actor_user_id: null,
        title: 'A IA parou de responder (Anthropic)',
      })
      expect(a.body).toMatch(/^Créditos ou cota de Anthropic esgotados/)
    }
    // Os marcados lidos são os dos agentes DAQUELE provedor, não arquivados.
    const agentes = chamadas.find((c) => c.tabela === 'cb_ia_agentes')
    expect(agentes?.filtros).toEqual([
      ['eq', 'account_id', 'conta-1'],
      ['eq', 'provedor', 'anthropic'],
      ['is', 'arquivado_em', null],
    ])
    // O primeiro não aposenta nada.
    expect(aposentadorias(chamadas)).toEqual([])
  })

  it('"continua" (6 h depois): o lembrete SUBSTITUI o anterior — só os alarmes deste episódio e deste provedor', async () => {
    const { db, chamadas } = bancoFalso({ rpc: { data: { acao: 'continua', desde: '2026-11-12T13:05:00Z', falhas: 9 } } })
    await registrarFalhaDaIa(db, ARGS)
    const [aposentar] = aposentadorias(chamadas)
    expect(aposentar.valores).toHaveProperty('read_at')
    expect(aposentar.filtros).toEqual([
      ['eq', 'account_id', 'conta-1'],
      ['eq', 'type', 'ia_falhou'],
      ['is', 'read_at', null],
      ['gte', 'created_at', '2026-11-12T13:05:00.000Z'],
      ['in', 'title', ['A IA parou de responder (Anthropic)', 'A IA continua parada (Anthropic)']],
    ])
    // Aposenta ANTES de gravar o novo (o UPDATE não pode pegar o lembrete).
    expect(chamadas.indexOf(aposentar)).toBeLessThan(
      chamadas.findIndex((c) => c.tabela === 'notifications' && c.op === 'insert'),
    )
    const avisos = inseridos(chamadas) as Array<Record<string, unknown>>
    expect(avisos[0]).toMatchObject({ type: 'ia_falhou', title: 'A IA continua parada (Anthropic)' })
    expect(avisos[0].body).toMatch(/9 respostas não saíram\.$/)
  })

  it('⚠️ a corrida com o "voltou" (Codex, #512): o episódio FECHOU entre a decisão e a gravação — os avisos que este turno gravou saem como lidos', async () => {
    const { db, chamadas } = bancoFalso({
      rpc: { data: { acao: 'abriu', desde: '2026-11-12T13:05:00.123456+00:00', falhas: 1 } },
      episodioDepois: { desde: '2026-11-12T13:05:00.123456+00:00', normalizou_em: '2026-11-12T13:05:01+00:00' },
    })
    await registrarFalhaDaIa(db, ARGS)
    const releu = chamadas.findIndex((c) => c.tabela === 'cb_ia_alarmes' && c.op === 'select')
    const gravou = chamadas.findIndex((c) => c.tabela === 'notifications' && c.op === 'insert')
    // Relê DEPOIS de gravar (um dos dois lados sempre vê o do outro).
    expect(releu).toBeGreaterThan(gravou)
    const [aposentar] = aposentadorias(chamadas)
    // Só os ids que ESTE turno gravou — o alarme de um episódio novo não é tocado.
    expect(aposentar.filtros).toEqual([
      ['in', 'id', ['aviso-1', 'aviso-2']],
      ['is', 'read_at', null],
    ])
  })

  it('o episódio já é OUTRO (fechou e reabriu): os avisos deste turno saem como lidos; o aberto e igual, não', async () => {
    const outro = bancoFalso({
      rpc: { data: { acao: 'abriu', desde: '2026-11-12T13:05:00Z', falhas: 1 } },
      episodioDepois: { desde: '2026-11-12T13:09:00Z', normalizou_em: null },
    })
    await registrarFalhaDaIa(outro.db, ARGS)
    expect(aposentadorias(outro.chamadas)).toHaveLength(1)
    // O mesmo, aberto (o caso comum): nada a aposentar. Microssegundos do
    // banco contra o milissegundo do JS: o mesmo instante.
    const mesmo = bancoFalso({
      rpc: { data: { acao: 'abriu', desde: '2026-11-12T13:05:00.123456+00:00', falhas: 1 } },
      episodioDepois: { desde: '2026-11-12T13:05:00.123456+00:00', normalizou_em: null },
    })
    await registrarFalhaDaIa(mesmo.db, ARGS)
    expect(aposentadorias(mesmo.chamadas)).toEqual([])
  })

  it('nunca lança: o RPC que falha (a 1140 sem aplicar) e a gravação recusada viram log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const semRpc = bancoFalso({ rpc: { error: { message: 'function cb_ia_registrar_falha does not exist' } } })
    await expect(registrarFalhaDaIa(semRpc.db, ARGS)).resolves.toBeUndefined()
    expect(inseridos(semRpc.chamadas)).toEqual([])
    const semCheck = bancoFalso({ rpc: { data: { acao: 'abriu', desde: '2026-11-12T13:05:00Z', falhas: 1 } }, erroNoInsert: true })
    await expect(registrarFalhaDaIa(semCheck.db, ARGS)).resolves.toBeUndefined()
    expect(erro).toHaveBeenCalledTimes(2)
  })
})

describe('registrarIaVoltou — a 1ª geração que deu certo fecha o episódio', () => {
  it('sem episódio aberto: só o UPDATE condicional, nenhum aviso', async () => {
    const { db, chamadas } = bancoFalso({ fechado: null })
    await registrarIaVoltou(db, { accountId: 'conta-1', provedor: 'gemini' })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]).toMatchObject({ tabela: 'cb_ia_alarmes', op: 'update' })
    // Só o ABERTO casa: dois processos não fecham (nem avisam) duas vezes.
    expect(chamadas[0].filtros).toEqual([
      ['eq', 'account_id', 'conta-1'],
      ['eq', 'provedor', 'gemini'],
      ['is', 'normalizou_em', null],
    ])
  })

  it('com episódio aberto: os alarmes dele saem como lidos (a caixinha vermelha fecha) e chega o "voltou"', async () => {
    const { db, chamadas } = bancoFalso({ fechado: { desde: '2026-11-12T13:05:00Z', falhas: 3 } })
    await registrarIaVoltou(db, { accountId: 'conta-1', provedor: 'gemini' })
    const [aposentar] = aposentadorias(chamadas)
    expect(aposentar.filtros).toContainEqual(['in', 'title', titulosDoAlarme(t, 'gemini')])
    expect(aposentar.filtros).toContainEqual(['gte', 'created_at', '2026-11-12T13:05:00.000Z'])
    const avisos = inseridos(chamadas) as Array<Record<string, unknown>>
    expect(avisos.map((a) => a.user_id)).toEqual(['dono', 'ana-marcada'])
    expect(avisos[0]).toMatchObject({ type: 'ia_voltou', title: 'A IA voltou a responder (Gemini)' })
    // "Desde" noutro dia ganha a data (o teste pode rodar depois do dia 12).
    expect(avisos[0].body).toMatch(/^Parada de (12\/11 )?10:05 a .+ · 3 respostas não saíram\. Confira as conversas em atraso\.$/)
  })
})

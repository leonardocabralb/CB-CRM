import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/cb/ia/conversa/[id] — o que a faixa do fio diz (D24–D27): o
// agente da ETAPA do card aberto que ATENDERIA a conversa, e a pausa. Para
// qualquer membro, com a conta da sessão em toda consulta. A regra é a do
// motor (`quemResponde`, a de verdade — não é mockada aqui).
// ============================================================

const CONV = '11111111-1111-4111-8111-111111111111'

type Consulta = { tabela: string; filtros: Array<[string, ...unknown[]]> }
const consultas: Consulta[] = []
let banco: Record<string, unknown>

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1', role: 'viewer' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 401 })),
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => ({
      select: () => {
        const c: Consulta = { tabela, filtros: [] }
        consultas.push(c)
        const q: Record<string, unknown> = {}
        for (const m of ['eq', 'order', 'limit', 'not', 'in', 'is']) {
          q[m] = (...a: unknown[]) => {
            c.filtros.push([m, ...a])
            return q
          }
        }
        q.maybeSingle = async () => ({ data: banco[tabela] ?? null, error: banco[`${tabela}:erro`] ?? null })
        // Lista (a leitura das últimas mensagens do cliente, `canalDaIaNaConversa`).
        q.then = (ok: (r: unknown) => unknown, erro: (e: unknown) => unknown) => {
          const v = banco[tabela]
          return Promise.resolve({
            data: Array.isArray(v) ? v : v ? [v] : [],
            error: banco[`${tabela}:erro`] ?? null,
          }).then(ok, erro)
        }
        return q
      },
    }),
  }),
}))

import { GET } from './route'

function chamar() {
  return GET(new Request('http://x'), { params: Promise.resolve({ conversationId: CONV }) })
}

beforeEach(() => {
  consultas.length = 0
  banco = {
    conversations: {
      id: CONV,
      contact_id: 'ct-1',
      group_id: null,
      channel_id: 'canal-1',
      ai_autoreply_disabled: false,
      ia_pausada_por: null,
    },
    cb_channels: { id: 'canal-1', kind: 'evolution', display_phone: '+55 83 99999-0000' },
    deals: { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' },
    cb_ia_agente_etapas: { stage_id: 'e1', ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' },
    cb_ia_agentes: {
      id: 'ag-1',
      nome: 'Triagem',
      ativo: true,
      arquivado_em: null,
      conexoes: ['canal-1'],
      ativado_em: '2026-09-20T12:00:00Z',
    },
  }
})

describe('GET /api/cb/ia/conversa/[id]', () => {
  it('card aberto numa etapa com agente: a faixa diz quem responde', async () => {
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      agente: { id: 'ag-1', nome: 'Triagem' },
      pausada: false,
      pausadaPor: null,
      // Sem a linha padrão de `ai_configs`: o padrão da conta (1138).
      pausaTemporaria: false,
      voltaAposMin: 15,
      voltaEm: null,
      motivo: null,
      naoAtende: null,
    })
  })

  it('o card é o ABERTO mais recente do contato, na conta da sessão', async () => {
    await chamar()
    const card = consultas.find((c) => c.tabela === 'deals')!
    expect(card.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
    expect(card.filtros).toContainEqual(['eq', 'contact_id', 'ct-1'])
    expect(card.filtros).toContainEqual(['eq', 'status', 'open'])
    expect(card.filtros).toContainEqual(['order', 'created_at', { ascending: false }])
    // Desempate (revisão de 09/11/2026): dois cards da mesma transação.
    expect(card.filtros).toContainEqual(['order', 'id', { ascending: false }])
    // `messages` não tem conta: é lida pela conversa, já conferida na conta.
    for (const c of consultas.filter((x) => x.tabela !== 'messages')) {
      expect(c.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
    }
  })

  it('⚠️ cards em dois funis: decide o mais recente cujo agente atende ESTA conexão (decisão do operador, 09/11/2026)', async () => {
    // O card NOVO (Trabalhista) numa etapa sem agente; o antigo (Bancário) na
    // etapa do agente desta conexão. Antes, o novo calava o agente do Bancário.
    banco.deals = [
      { id: 'd-novo', stage_id: 'e-trab', pipeline_id: 'f-trab', etapa_desde: '2026-09-27T12:00:00Z' },
      { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' },
    ]
    expect(await (await chamar()).json()).toMatchObject({ agente: { id: 'ag-1', nome: 'Triagem' }, motivo: null })
    // Sem agente que atenda a conexão em nenhum card: o mais recente diz por que ninguém atende.
    banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), conexoes: ['canal-9'] }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'etapa_sem_agente' })
  })

  it('o "cliente" que é o número de OUTRA conexão da conta: ninguém, sem nem procurar card', async () => {
    banco.contacts = { phone: '5583999990000' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_do_alcance', naoAtende: null })
    expect(consultas.some((c) => c.tabela === 'deals')).toBe(false)
    // Outro número: segue como sempre.
    banco.contacts = { phone: '5583988887777' }
    expect(await (await chamar()).json()).toMatchObject({ agente: { id: 'ag-1', nome: 'Triagem' } })
  })

  it('⚠️ D27: card que já estava na etapa antes de ela ser marcada — ninguém', async () => {
    banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-01T00:00:00Z' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'card_antigo' })
  })

  it('sem card, etapa sem agente, agente desligado', async () => {
    banco.deals = null
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'sem_card' })
    banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' }
    banco.cb_ia_agente_etapas = null
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'etapa_sem_agente' })
    banco.cb_ia_agente_etapas = { stage_id: 'e1', ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' }
    banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: false }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'agente_desligado' })
  })

  it('pausada: devolve o motivo e AINDA o agente (a faixa oferece Retomar)', async () => {
    banco.conversations = {
      ...(banco.conversations as object),
      ai_autoreply_disabled: true,
      ia_pausada_por: 'gente',
    }
    expect(await (await chamar()).json()).toMatchObject({
      agente: { id: 'ag-1', nome: 'Triagem' },
      pausada: true,
      pausadaPor: 'gente',
    })
  })

  it('⚠️ D27: card que entrou na etapa antes de o agente ser LIGADO — ninguém', async () => {
    banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativado_em: '2026-09-26T00:00:00Z' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'card_antigo' })
  })

  it('encerrada: ninguém atende (a faixa não oferece Pausar) — Codex, #309', async () => {
    banco.conversations = { ...(banco.conversations as object), status: 'closed' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'encerrada' })
  })

  it('a conexão é a da ÚLTIMA mensagem do cliente, não a fixada na conversa — Codex, #309', async () => {
    banco.conversations = { ...(banco.conversations as object), channel_id: 'canal-2' }
    banco.messages = [{ channel_id: 'canal-1', content_type: 'text', content_text: 'oi', media_type: null }]
    expect(await (await chamar()).json()).toMatchObject({ agente: { id: 'ag-1', nome: 'Triagem' } })
    const ultima = consultas.find((c) => c.tabela === 'messages')!
    expect(ultima.filtros).toContainEqual(['eq', 'conversation_id', CONV])
    expect(ultima.filtros).toContainEqual(['eq', 'sender_type', 'customer'])
    expect(ultima.filtros).toContainEqual(['is', 'deleted_at', null])
  })

  it('figurinha, localização e texto vazio NÃO mudam a conexão: vale a última que abre turno — Codex, #309', async () => {
    banco.conversations = { ...(banco.conversations as object), channel_id: 'canal-2' }
    banco.messages = [
      { channel_id: 'canal-2', content_type: 'image', content_text: null, media_type: 'image/webp' },
      { channel_id: 'canal-2', content_type: 'location', content_text: null, media_type: null },
      { channel_id: 'canal-2', content_type: 'text', content_text: null, media_type: null },
      { channel_id: 'canal-1', content_type: 'text', content_text: 'quero o boleto', media_type: null },
    ]
    expect(await (await chamar()).json()).toMatchObject({ agente: { id: 'ag-1', nome: 'Triagem' } })
  })

  it('conexão da conversa fora das do agente — ninguém', async () => {
    banco.conversations = { ...(banco.conversations as object), channel_id: 'canal-2' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_da_conexao' })
  })

  it('grupo e Instagram: ninguém, sem nem procurar card', async () => {
    banco.conversations = { ...(banco.conversations as object), group_id: 'g-1', contact_id: null }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_do_alcance' })
    expect(consultas.some((c) => c.tabela === 'deals')).toBe(false)
    banco.conversations = { ...(banco.conversations as object), group_id: null, contact_id: 'ct-1' }
    banco.cb_channels = { id: 'canal-1', kind: 'instagram' }
    consultas.length = 0
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_do_alcance' })
    expect(consultas.some((c) => c.tabela === 'deals')).toBe(false)
  })

  describe('naoAtende — a etapa TEM agente, mas ele não atende esta conversa (validação de 25/10/2026)', () => {
    it('⚠️ card antigo depois de desligar e religar o agente (D27): o nome e o motivo, nunca silêncio', async () => {
      // Religado agora: o card que já estava na etapa ficou "antigo".
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativado_em: '2026-09-26T00:00:00Z' }
      expect(await (await chamar()).json()).toEqual({
        agente: null,
        pausada: false,
        pausadaPor: null,
        // Sem agente que atenda e sem pausa, o N da conta nem é lido.
        pausaTemporaria: false,
        voltaAposMin: 0,
        voltaEm: null,
        motivo: 'card_antigo',
        naoAtende: { agente: { id: 'ag-1', nome: 'Triagem' }, motivo: 'card_antigo' },
      })
    })

    it('agente desligado e conexão fora das dele: o motivo de cada um', async () => {
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: false }
      expect((await (await chamar()).json()).naoAtende).toEqual({
        agente: { id: 'ag-1', nome: 'Triagem' },
        motivo: 'agente_desligado',
      })
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: true, conexoes: ['canal-9'] }
      expect((await (await chamar()).json()).naoAtende).toEqual({
        agente: { id: 'ag-1', nome: 'Triagem' },
        motivo: 'fora_da_conexao',
      })
    })

    it('com a IA pausada também: a faixa pode dizer que, retomada, ela ainda não atenderia', async () => {
      banco.conversations = { ...(banco.conversations as object), ai_autoreply_disabled: true, ia_pausada_por: 'gente' }
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativado_em: '2026-09-26T00:00:00Z' }
      expect(await (await chamar()).json()).toMatchObject({
        pausada: true,
        pausadaPor: 'gente',
        naoAtende: { agente: { id: 'ag-1', nome: 'Triagem' }, motivo: 'card_antigo' },
      })
    })

    it('sem agente a nomear (sem card, etapa sem agente), atendendo, encerrada, grupo: nulo', async () => {
      expect((await (await chamar()).json()).naoAtende).toBeNull()
      banco.cb_ia_agente_etapas = null
      expect((await (await chamar()).json()).naoAtende).toBeNull()
      banco.deals = null
      expect((await (await chamar()).json()).naoAtende).toBeNull()
      banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-01T00:00:00Z' }
      banco.cb_ia_agente_etapas = { stage_id: 'e1', ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' }
      // Card antigo, mas a conversa está encerrada: o motor para antes (encerrada).
      banco.conversations = { ...(banco.conversations as object), status: 'closed' }
      expect(await (await chamar()).json()).toMatchObject({ motivo: 'encerrada', naoAtende: null })
      banco.conversations = { ...(banco.conversations as object), status: 'open', group_id: 'g-1', contact_id: null }
      expect(await (await chamar()).json()).toMatchObject({ motivo: 'fora_do_alcance', naoAtende: null })
    })

    it('⚠️ de qualquer membro: do agente sai SÓ id e nome — nunca conexões, datas ou instruções', async () => {
      banco.cb_ia_agentes = {
        ...(banco.cb_ia_agentes as object),
        ativo: false,
        instrucoes: 'segredo do administrador',
      }
      const corpo = await (await chamar()).json()
      expect(Object.keys(corpo).sort()).toEqual([
        'agente',
        'motivo',
        'naoAtende',
        'pausaTemporaria',
        'pausada',
        'pausadaPor',
        'voltaAposMin',
        'voltaEm',
      ])
      expect(Object.keys(corpo.naoAtende).sort()).toEqual(['agente', 'motivo'])
      expect(Object.keys(corpo.naoAtende.agente).sort()).toEqual(['id', 'nome'])
      expect(JSON.stringify(corpo)).not.toMatch(/canal-1|2026-09|segredo/)
    })
  })

  it('conversa de outra conta (ou inexistente): 404', async () => {
    banco.conversations = null
    expect((await chamar()).status).toBe(404)
  })

  it('erro de banco é 500, nunca "ninguém responde"', async () => {
    banco['deals:erro'] = { message: 'timeout' }
    expect((await chamar()).status).toBe(500)
  })

  describe('a pausa TEMPORÁRIA (1138)', () => {
    beforeEach(() => {
      banco.conversations = { ...(banco.conversations as object), ai_autoreply_disabled: true, ia_pausada_por: 'gente' }
      banco.ai_configs = { ia_volta_apos_min: 15 }
    })

    it('pausa por gente com N > 0: temporária, com o N e quando a IA volta (o pendente que espera a equipe)', async () => {
      banco.cb_ia_turnos = [{ executar_apos: '2026-11-11T15:15:00Z' }]
      expect(await (await chamar()).json()).toMatchObject({
        pausada: true,
        pausadaPor: 'gente',
        pausaTemporaria: true,
        voltaAposMin: 15,
        voltaEm: '2026-11-11T15:15:00Z',
      })
      const espera = consultas.find((c) => c.tabela === 'cb_ia_turnos')!
      expect(espera.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
      expect(espera.filtros).toContainEqual(['eq', 'status', 'aguardando'])
      expect(espera.filtros).toContainEqual(['eq', 'erro', 'aguardando a equipe responder'])
    })

    it('sem mensagem esperando: temporária, sem a hora', async () => {
      expect(await (await chamar()).json()).toMatchObject({ pausaTemporaria: true, voltaEm: null })
    })

    it('N = 0 na conta: a pausa não é temporária (como antes), e nada de procurar a espera', async () => {
      banco.ai_configs = { ia_volta_apos_min: 0 }
      expect(await (await chamar()).json()).toMatchObject({ pausaTemporaria: false, voltaAposMin: 0, voltaEm: null })
      expect(consultas.some((c) => c.tabela === 'cb_ia_turnos')).toBe(false)
    })

    it.each(['desativada', 'transferencia', 'automacao'])('pausa %s: permanente', async (motivo) => {
      banco.conversations = { ...(banco.conversations as object), ia_pausada_por: motivo }
      expect(await (await chamar()).json()).toMatchObject({ pausaTemporaria: false, voltaAposMin: 15 })
    })

    it('nenhum agente atenderia (desligado; card fora da etapa dele): NÃO é "temporária" — nenhum turno nasceria', async () => {
      banco.cb_ia_turnos = [{ executar_apos: '2026-11-11T15:15:00Z' }]
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: false }
      expect(await (await chamar()).json()).toMatchObject({ pausada: true, pausaTemporaria: false, voltaEm: null })
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: true }
      banco.cb_ia_agente_etapas = null
      expect(await (await chamar()).json()).toMatchObject({ pausada: true, pausaTemporaria: false, voltaEm: null })
    })

    it('a leitura do N da conta que falha é 500 (nunca "não volta" por ignorância)', async () => {
      banco['ai_configs:erro'] = { message: 'timeout' }
      expect((await chamar()).status).toBe(500)
    })
  })
})

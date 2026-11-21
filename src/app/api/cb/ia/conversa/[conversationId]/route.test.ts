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
      encerrada: false,
      agenteDoFollowUp: null,
      pausada: false,
      pausadaPor: null,
      // Sem a linha padrão de `ai_configs`: o padrão da conta (1138).
      pausaTemporaria: false,
      voltaAposMin: 15,
      voltaEm: null,
      // Nada na fila da IA.
      proximo: null,
      motivo: null,
      naoAtende: null,
      etapaSemAgente: null,
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

  it('encerrada: a RESPOSTA não sai (Codex, #309) — fora do território de um agente, ninguém, como antes', async () => {
    banco.conversations = { ...(banco.conversations as object), status: 'closed' }
    banco.cb_ia_agente_etapas = null
    expect(await (await chamar()).json()).toMatchObject({
      agente: null,
      encerrada: true,
      agenteDoFollowUp: null,
      motivo: 'encerrada',
    })
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

  describe('etapaSemAgente — o card numa etapa SEM agente, numa conversa que a IA já atendeu (16/11/2026)', () => {
    // O agente do Trabalhista move quem ainda trabalha para "Ag. Demissão"
    // (sem agente): a faixa ficava vazia depois do "Retomar IA", e a equipe
    // tentava pausar e desativar uma IA que não atendia mais.
    beforeEach(() => {
      banco.cb_ia_agente_etapas = null
      banco.pipeline_stages = { name: ' Ag. Demissão ' }
    })

    it('⚠️ a IA já atendeu (`ia_agente_id`): o NOME da etapa, lido pelos funis DA CONTA', async () => {
      banco.conversations = { ...(banco.conversations as object), ia_agente_id: 'ag-1' }
      const corpo = await (await chamar()).json()
      expect(corpo).toMatchObject({ agente: null, motivo: 'etapa_sem_agente', naoAtende: null, etapaSemAgente: { etapa: 'Ag. Demissão' } })
      const etapa = consultas.find((c) => c.tabela === 'pipeline_stages')!
      expect(etapa.filtros).toContainEqual(['eq', 'pipelines.account_id', 'conta-1'])
      expect(etapa.filtros).toContainEqual(['eq', 'id', 'e1'])
    })

    it('a pausada ganha o mesmo nome (a pausa não entra na decisão da etapa)', async () => {
      banco.conversations = {
        ...(banco.conversations as object),
        ia_agente_id: 'ag-1',
        ai_autoreply_disabled: true,
        ia_pausada_por: 'gente',
      }
      expect(await (await chamar()).json()).toMatchObject({ pausada: true, etapaSemAgente: { etapa: 'Ag. Demissão' } })
    })

    it('a conversa que NENHUM agente atendeu: nulo, sem nem ler a etapa (a maioria das conversas fora da IA)', async () => {
      expect(await (await chamar()).json()).toMatchObject({ motivo: 'etapa_sem_agente', etapaSemAgente: null })
      expect(consultas.some((c) => c.tabela === 'pipeline_stages')).toBe(false)
    })

    it('agente atendendo, sem card ou encerrada: nulo, sem ler a etapa', async () => {
      banco.conversations = { ...(banco.conversations as object), ia_agente_id: 'ag-1' }
      banco.cb_ia_agente_etapas = { stage_id: 'e1', ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' }
      expect(await (await chamar()).json()).toMatchObject({ agente: { id: 'ag-1', nome: 'Triagem' }, etapaSemAgente: null })
      banco.cb_ia_agente_etapas = null
      banco.deals = null
      expect(await (await chamar()).json()).toMatchObject({ motivo: 'sem_card', etapaSemAgente: null })
      banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' }
      banco.conversations = { ...(banco.conversations as object), status: 'closed' }
      expect(await (await chamar()).json()).toMatchObject({ etapaSemAgente: null })
      expect(consultas.some((c) => c.tabela === 'pipeline_stages')).toBe(false)
    })

    it('etapa sem nome (lida vazia): nulo; leitura que FALHA: 500, como as outras', async () => {
      banco.conversations = { ...(banco.conversations as object), ia_agente_id: 'ag-1' }
      banco.pipeline_stages = { name: '   ' }
      expect(await (await chamar()).json()).toMatchObject({ etapaSemAgente: null })
      banco['pipeline_stages:erro'] = { message: 'falhou' }
      expect((await chamar()).status).toBe(500)
    })
  })

  describe('naoAtende — a etapa TEM agente, mas ele não atende esta conversa (validação de 25/10/2026)', () => {
    it('⚠️ card antigo depois de desligar e religar o agente (D27): o nome e o motivo, nunca silêncio', async () => {
      // Religado agora: o card que já estava na etapa ficou "antigo".
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativado_em: '2026-09-26T00:00:00Z' }
      expect(await (await chamar()).json()).toEqual({
        agente: null,
        encerrada: false,
        agenteDoFollowUp: null,
        pausada: false,
        pausadaPor: null,
        // Sem agente que atenda e sem pausa, o N da conta nem é lido.
        pausaTemporaria: false,
        voltaAposMin: 0,
        voltaEm: null,
        // Ninguém atende: a fila nem é lida, e `proximo` vem AUSENTE (nulo
        // faria a faixa reler a cada 2 min).
        motivo: 'card_antigo',
        naoAtende: { agente: { id: 'ag-1', nome: 'Triagem' }, motivo: 'card_antigo' },
        etapaSemAgente: null,
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
        'agenteDoFollowUp',
        'encerrada',
        // O nome da etapa (16/11/2026): todo membro já o vê no funil.
        'etapaSemAgente',
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
      // A espera da equipe OU a da abertura do horário (a resposta reagendada
      // para as 08:00 continua sendo a volta).
      expect(espera.filtros).toContainEqual([
        'in',
        'erro',
        ['aguardando a equipe responder', 'fora do horário do agente: responde quando o horário abrir'],
      ])
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

  describe('o PRÓXIMO PASSO da IA (pedido do operador, 12/11/2026)', () => {
    const turnosVivos = () => consultas.filter((c) => c.tabela === 'cb_ia_turnos')
    // O dono da decisão de agora (o card d1 na etapa e1 do agente ag-1).
    const DONO = { ia_agente_id: 'ag-1', deal_id: 'd1', stage_id: 'e1' }

    it('⚠️ o follow-up armado na etapa ANTERIOR (outro agente) não é o próximo passo — Codex, #515', async () => {
      banco.cb_ia_turnos = [
        {
          tipo: 'retomada',
          status: 'aguardando',
          executar_apos: '2026-11-12T18:00:00Z',
          tentativa: 1,
          tentativas: 3,
          erro: null,
          ia_agente_id: 'ag-velho',
          deal_id: 'd1',
          stage_id: 'e-velha',
        },
      ]
      expect((await (await chamar()).json()).proximo).toBeNull()
    })

    it('follow-up agendado: a tentativa, de quantas, e a hora — lido na conta, só os vivos', async () => {
      banco.cb_ia_turnos = [
        { tipo: 'retomada', status: 'aguardando', executar_apos: '2026-11-12T18:00:00Z', tentativa: 2, tentativas: 5, erro: null, ...DONO },
      ]
      expect((await (await chamar()).json()).proximo).toEqual({
        tipo: 'retomada',
        em: '2026-11-12T18:00:00Z',
        tentativa: 2,
        tentativas: 5,
      })
      const leitura = turnosVivos().at(-1)!
      expect(leitura.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
      expect(leitura.filtros).toContainEqual(['eq', 'conversation_id', CONV])
      expect(leitura.filtros).toContainEqual(['in', 'status', ['aguardando', 'rodando']])
    })

    it('turno rodando: "agora"; resposta na fila fora do horário: com a marca', async () => {
      banco.cb_ia_turnos = [{ tipo: 'resposta', status: 'rodando', executar_apos: '2026-11-12T18:00:00Z', erro: null, ...DONO }]
      expect((await (await chamar()).json()).proximo).toEqual({ tipo: 'agora' })
      banco.cb_ia_turnos = [
        {
          tipo: 'resposta',
          status: 'aguardando',
          executar_apos: '2026-11-13T11:00:00Z',
          erro: 'fora do horário do agente: responde quando o horário abrir',
          ...DONO,
        },
      ]
      expect((await (await chamar()).json()).proximo).toEqual({
        tipo: 'resposta',
        em: '2026-11-13T11:00:00Z',
        foraDoHorario: true,
      })
    })

    it('⚠️ ninguém atende (card antigo, aberta ou encerrada): nem lê a fila', async () => {
      banco.cb_ia_turnos = [
        { tipo: 'retomada', status: 'aguardando', executar_apos: '2026-11-12T18:00:00Z', tentativa: 1, tentativas: 3, erro: null, ...DONO },
      ]
      banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-01T00:00:00Z' }
      for (const status of ['open', 'closed']) {
        banco.conversations = { ...(banco.conversations as object), status }
        // AUSENTE, não nulo: a faixa não relê sozinha uma conversa sem agente.
        expect('proximo' in (await (await chamar()).json())).toBe(false)
      }
      expect(turnosVivos()).toHaveLength(0)
    })

    it('⚠️ pausa PERMANENTE: nada (o follow-up armado seria descartado no vencimento)', async () => {
      banco.ai_configs = { ia_volta_apos_min: 15 }
      banco.cb_ia_turnos = [
        { tipo: 'retomada', status: 'aguardando', executar_apos: '2026-11-12T18:00:00Z', tentativa: 1, tentativas: 3, erro: null, ...DONO },
      ]
      for (const motivo of ['transferencia', 'desativada', 'automacao']) {
        banco.conversations = { ...(banco.conversations as object), ai_autoreply_disabled: true, ia_pausada_por: motivo }
        expect('proximo' in (await (await chamar()).json())).toBe(false)
      }
    })

    it('pausa temporária: o follow-up atravessa só a pausa `gente`, nunca o "Pausar" (`botao`)', async () => {
      banco.ai_configs = { ia_volta_apos_min: 15 }
      banco.cb_ia_turnos = [
        { tipo: 'retomada', status: 'aguardando', executar_apos: '2026-11-12T18:00:00Z', tentativa: 1, tentativas: 3, erro: null, ...DONO },
      ]
      banco.conversations = { ...(banco.conversations as object), ai_autoreply_disabled: true, ia_pausada_por: 'gente' }
      expect((await (await chamar()).json()).proximo).toMatchObject({ tipo: 'retomada', tentativa: 1 })
      banco.conversations = { ...(banco.conversations as object), ia_pausada_por: 'botao' }
      expect((await (await chamar()).json()).proximo).toBeNull()
    })

    it('a leitura da fila que falha é 500 (nunca "nada agendado" por ignorância)', async () => {
      banco['cb_ia_turnos:erro'] = { message: 'timeout' }
      expect((await chamar()).status).toBe(500)
    })
  })

  describe('a conversa ENCERRADA com o follow-up da IA na fila (1146; pedido do operador, 14/11/2026)', () => {
    const turnosVivos = () => consultas.filter((c) => c.tabela === 'cb_ia_turnos')
    const DONO = { ia_agente_id: 'ag-1', deal_id: 'd1', stage_id: 'e1' }
    const FOLLOW_UP = {
      tipo: 'retomada',
      status: 'aguardando',
      executar_apos: '2026-11-14T18:00:00Z',
      tentativa: 2,
      tentativas: 5,
      erro: null,
      ...DONO,
    }

    beforeEach(() => {
      banco.conversations = { ...(banco.conversations as object), status: 'closed' }
      banco.ai_configs = { ia_volta_apos_min: 15 }
    })

    it('⚠️ o card segue na etapa do agente: o agente DO FOLLOW-UP, a marca de encerrada e o próximo follow-up (a faixa o mostra, com Pausar e Desativar)', async () => {
      banco.cb_ia_turnos = [FOLLOW_UP]
      expect(await (await chamar()).json()).toEqual({
        // A RESPOSTA continua parada: `agente` nulo e o motivo, como antes — a
        // faixa de antes, ainda aberta num navegador no deploy, não diz
        // "responde nesta conversa".
        agente: null,
        encerrada: true,
        agenteDoFollowUp: { id: 'ag-1', nome: 'Triagem' },
        pausada: false,
        pausadaPor: null,
        // Nada de "volta": nenhuma mensagem do cliente espera a equipe.
        pausaTemporaria: false,
        voltaAposMin: 15,
        voltaEm: null,
        proximo: { tipo: 'retomada', em: '2026-11-14T18:00:00Z', tentativa: 2, tentativas: 5 },
        motivo: 'encerrada',
        naoAtende: null,
        etapaSemAgente: null,
      })
      const leitura = turnosVivos().at(-1)!
      expect(leitura.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
      expect(leitura.filtros).toContainEqual(['eq', 'conversation_id', CONV])
      expect(leitura.filtros).toContainEqual(['in', 'status', ['aguardando', 'rodando']])
    })

    it('⚠️ fila vazia (o vão entre o follow-up que saiu e o seguinte, ou a série que acabou): `proximo` NULO, nunca ausente — a faixa some, mas continua relendo (Codex, #515)', async () => {
      const corpo = await (await chamar()).json()
      expect(corpo).toMatchObject({ agente: null, agenteDoFollowUp: { id: 'ag-1', nome: 'Triagem' }, encerrada: true })
      expect(corpo.proximo).toBeNull()
    })

    it('a RESPOSTA que sobrou na fila não conta (a reserva a recusa na encerrada): nem "responde", nem "agora"', async () => {
      const resposta = { ...FOLLOW_UP, tipo: 'resposta', executar_apos: '2026-11-14T17:00:00Z', tentativa: 1, tentativas: 1 }
      banco.cb_ia_turnos = [resposta]
      expect((await (await chamar()).json()).proximo).toBeNull()
      banco.cb_ia_turnos = [{ ...resposta, status: 'rodando' }]
      expect((await (await chamar()).json()).proximo).toBeNull()
      banco.cb_ia_turnos = [resposta, FOLLOW_UP]
      expect((await (await chamar()).json()).proximo).toMatchObject({ tipo: 'retomada', tentativa: 2 })
    })

    it('o follow-up saindo agora; a pré-armação da fala da equipe (sem dono ainda) relê até resolver', async () => {
      banco.cb_ia_turnos = [{ ...FOLLOW_UP, status: 'rodando' }]
      expect((await (await chamar()).json()).proximo).toEqual({ tipo: 'agora' })
      banco.cb_ia_turnos = [
        {
          ...FOLLOW_UP,
          tentativa: 1,
          tentativas: 1,
          erro: 'armar a partir da fala da equipe',
          ia_agente_id: null,
          deal_id: null,
          stage_id: null,
        },
      ]
      expect((await (await chamar()).json()).proximo).toEqual({ tipo: 'agendando', em: '2026-11-14T18:00:00Z' })
    })

    it('⚠️ o follow-up de OUTRO dono (card movido para a etapa de outro agente) não é o próximo passo', async () => {
      banco.cb_ia_turnos = [{ ...FOLLOW_UP, ia_agente_id: 'ag-velho', stage_id: 'e-velha' }]
      expect((await (await chamar()).json()).proximo).toBeNull()
    })

    it('⚠️ depois do "Pausar" (`botao`) ou do "Desativar" (e nas outras pausas permanentes): sem agente e sem ler a fila — a faixa some na hora, e o follow-up para no vencimento', async () => {
      banco.cb_ia_turnos = [FOLLOW_UP]
      for (const motivo of ['botao', 'desativada', 'transferencia', 'automacao']) {
        banco.conversations = { ...(banco.conversations as object), ai_autoreply_disabled: true, ia_pausada_por: motivo }
        const corpo = await (await chamar()).json()
        expect(corpo, motivo).toMatchObject({
          agente: null,
          agenteDoFollowUp: null,
          encerrada: true,
          pausada: true,
          motivo: 'encerrada',
        })
        expect('proximo' in corpo, motivo).toBe(false)
      }
      expect(turnosVivos()).toHaveLength(0)
    })

    it('a pausa `gente` com N > 0 o follow-up atravessa; com N = 0, não', async () => {
      banco.cb_ia_turnos = [FOLLOW_UP]
      banco.conversations = { ...(banco.conversations as object), ai_autoreply_disabled: true, ia_pausada_por: 'gente' }
      expect(await (await chamar()).json()).toMatchObject({
        agenteDoFollowUp: { id: 'ag-1', nome: 'Triagem' },
        pausaTemporaria: false,
        proximo: { tipo: 'retomada', tentativa: 2 },
      })
      banco.ai_configs = { ia_volta_apos_min: 0 }
      const semVolta = await (await chamar()).json()
      expect(semVolta).toMatchObject({ agenteDoFollowUp: null, motivo: 'encerrada' })
      expect('proximo' in semVolta).toBe(false)
    })

    it('o card fora do território do agente (sem card aberto, etapa sem agente, agente desligado): sem agente e sem fila, como antes', async () => {
      banco.cb_ia_turnos = [FOLLOW_UP]
      const semFaixa = async () => {
        const corpo = await (await chamar()).json()
        expect(corpo).toMatchObject({
          agente: null,
          agenteDoFollowUp: null,
          encerrada: true,
          motivo: 'encerrada',
          naoAtende: null,
        })
        expect('proximo' in corpo).toBe(false)
      }
      banco.deals = null
      await semFaixa()
      banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' }
      banco.cb_ia_agente_etapas = null
      await semFaixa()
      banco.cb_ia_agente_etapas = { stage_id: 'e1', ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' }
      banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: false }
      await semFaixa()
      expect(turnosVivos()).toHaveLength(0)
    })
  })
})

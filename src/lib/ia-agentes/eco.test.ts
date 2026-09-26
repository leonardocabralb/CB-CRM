import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { criarBanco, type Banco, type Linha } from '@/lib/whatsapp/sem-telefone/banco.test-helper'

import { assumirEcoDoTurno } from './eco'

// ============================================================
// O eco da resposta do agente (E5): reconhecido pelo id do turno, gravado COMO
// a resposta do agente — nunca como mensagem do celular, e sem motor nenhum.
// O banco é o dublê em memória de `sem-telefone/` (imita a forma SUPOSTA do
// PostgREST; vale como pino do COMPORTAMENTO). Ids e números fictícios.
// ============================================================

const LID = '100000000000000@lid'
const TEL = '5583900000000@s.whatsapp.net'
const AGORA = 1789747434 // 2026-09-18T16:03:54Z
const ID = '3EB0-RESPOSTA-DA-IA'
const TEXTO = 'Olá! Vou verificar o seu contrato.\n\n— Escritório'

const turno = (over: Linha = {}): Linha => ({
  id: 'turno-1',
  account_id: 'conta-1',
  conversation_id: 'conv-1',
  canal_id: 'canal-1',
  ia_agente_id: 'agente-1',
  mensagem_enviada_id: ID,
  status: 'rodando',
  ...over,
})

/** O eco da Evolution 2.4: telefone em `remoteJid`, LID em `remoteJidAlt`. */
const eco = (over: Linha = {}) => ({
  key: { remoteJid: TEL, remoteJidAlt: LID, fromMe: true, id: ID },
  message: { conversation: TEXTO },
  messageType: 'conversation',
  messageTimestamp: AGORA,
  ...over,
})

let b: Banco
beforeEach(() => {
  b = criarBanco({
    cb_ia_turnos: [turno()],
    conversations: [{ id: 'conv-1', account_id: 'conta-1', last_message_text: 'pergunta do cliente' }],
    messages: [],
  })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const assumir = (item = eco(), accountId = 'conta-1') =>
  assumirEcoDoTurno(b.db, { accountId, providerMessageId: ID, item })

describe('assumirEcoDoTurno', () => {
  it('eco de turno sem linha: grava COMO a resposta do agente, na conversa do turno, e atualiza a prévia', async () => {
    expect(await assumir()).toBe(true)

    expect(b.tabelas.messages).toHaveLength(1)
    const linha = b.tabelas.messages[0]
    expect(linha).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      ia_agente_id: 'agente-1',
      channel_id: 'canal-1',
      content_type: 'text',
      content_text: TEXTO,
      message_id: ID,
      remote_jid: TEL,
      remote_jid_lid: LID,
      from_me: true,
      status: 'sent',
      ai_generated: true,
      created_at: new Date(AGORA * 1000).toISOString(),
    })
    // Nunca a marca do celular: é ela que a 1049 lê como "gente respondeu".
    expect(linha).not.toHaveProperty('from_device')
    expect(linha).not.toHaveProperty('sender_id')

    expect(b.tabelas.conversations[0]).toMatchObject({ last_message_text: TEXTO })
    expect(typeof b.tabelas.conversations[0].last_message_at).toBe('string')
    // Nenhuma RPC (nada de fila, de pausa, de reabertura).
    expect(b.rpcs).toEqual([])
  })

  it('o INSERT do envio chegou no meio (23505): `true`, nada gravado de novo e a prévia fica com o envio', async () => {
    b.tabelas.messages.push({ id: 'msg-envio', conversation_id: 'conv-1', message_id: ID, sender_type: 'bot' })
    expect(await assumir()).toBe(true)
    expect(b.tabelas.messages).toHaveLength(1)
    expect(b.escritas.filter((e) => e.tabela === 'conversations')).toEqual([])
    expect(b.tabelas.conversations[0].last_message_text).toBe('pergunta do cliente')
  })

  it('id que não é de turno: `false` (o caminho de sempre) e nada escrito', async () => {
    b.tabelas.cb_ia_turnos = [turno({ mensagem_enviada_id: 'OUTRO-ID' })]
    expect(await assumir()).toBe(false)
    expect(b.escritas).toEqual([])
  })

  it('turno de OUTRA conta com o mesmo id: `false` e nada escrito no fio dela', async () => {
    b.tabelas.cb_ia_turnos = [turno({ account_id: 'conta-2', conversation_id: 'conv-da-outra' })]
    expect(await assumir()).toBe(false)
    expect(b.escritas).toEqual([])
  })

  it('a leitura do turno falha: `false` — o caminho de sempre, nunca lança', async () => {
    b.falhas.cb_ia_turnos = { code: '57014', message: 'canceling statement due to statement timeout' }
    await expect(assumir()).resolves.toBe(false)
    expect(b.escritas).toEqual([])
  })

  it('o INSERT falha por outro motivo: `false`, e a prévia não é tocada', async () => {
    b.falhas.messages = { code: '42501', message: 'permission denied' }
    expect(await assumir()).toBe(false)
    expect(b.escritas.filter((e) => e.tabela === 'conversations')).toEqual([])
  })

  it('eco em `@lid` SEM telefone: grava com o LID para agir sobre a mensagem, e sem telefone inventado', async () => {
    expect(await assumir(eco({ key: { remoteJid: LID, fromMe: true, id: ID } }))).toBe(true)
    expect(b.tabelas.messages[0]).toMatchObject({
      sender_type: 'bot',
      ia_agente_id: 'agente-1',
      remote_jid: null,
      remote_jid_lid: LID,
    })
  })

  it('sem carimbo no item: `created_at` fica com o do banco', async () => {
    expect(await assumir(eco({ messageTimestamp: undefined }))).toBe(true)
    expect(b.tabelas.messages[0]).not.toHaveProperty('created_at')
  })
})

describe('lendo o fonte: o eco não aciona nada da ingestão', () => {
  const fonte = readFileSync(join(__dirname, 'eco.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  // DEFAULT-DENY: importação nova entra aqui por decisão visível no diff. O
  // eco é o INSERT do envio feito por outra mão — motor, funil, reabertura,
  // fila do agente ou webhook de saída importados aqui rodariam para a
  // resposta do próprio agente.
  const PERMITIDAS = [
    '@supabase/supabase-js',
    '@/lib/cb-channels/stamp',
    '@/lib/whatsapp/transport/evolution-inbound',
  ]

  it('importa só da lista fechada', () => {
    const importadas = [...fonte.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
    expect(importadas.length).toBeGreaterThan(0)
    for (const modulo of importadas) expect(PERMITIDAS, modulo).toContain(modulo)
  })

  it('não cita nenhum motor nem caminho da ingestão', () => {
    for (const nome of [
      'persistDeviceMessage',
      'persistInboundMessage',
      'dispatchInbound',
      'runAutomationsForTrigger',
      'dispararAutomacoes',
      'routeContactToPipeline',
      'reopenClosedConversation',
      'cancelarEsperasPorResposta',
      'followConversationChannel',
      'registrarEntrega',
      'aoChegarMensagemDoCliente',
      'enfileirarTurno',
      'dispatchWebhookEvent',
      'from_device',
      '.rpc(',
    ]) {
      expect(fonte, nome).not.toContain(nome)
    }
  })

  it('grava como o agente: `bot`, com o agente do turno e pelo `gravarComCanal`', () => {
    expect(fonte).toContain("sender_type: 'bot'")
    expect(fonte).toContain('ia_agente_id: turno.ia_agente_id')
    expect(fonte).toContain('gravarComCanal(')
    expect(fonte).toContain('channel_id: canal,')
  })
})

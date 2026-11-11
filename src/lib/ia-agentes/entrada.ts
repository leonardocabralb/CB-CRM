// ============================================================
// A PORTA da ingestão para os agentes de IA (docs/PLANO-agentes-de-ia.md,
// D24–D27). A ingestão chama `aoChegarMensagemDoCliente` DEPOIS do robô e
// das automações; aqui se leem os fatos (`lerQuemAtende`: a conversa, o card
// aberto do contato, o agente da etapa dele), a regra pura (`quemResponde`)
// decide, e o turno é só ENFILEIRADO com o agente, o card e a etapa — quem
// executa é o disparo agendado (`turno.ts`) ou a rede do cron.
//
// ⚠️ Nunca lança e nunca espera o agente: a ingestão ainda tem o webhook de
// saída `message.received` e os itens seguintes do lote atrás dela.
// ⚠️ Quando o robô ou uma automação respondeu, nenhuma leitura: um UPDATE
// que descarta o pendente da conexão, e volta.
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'

import { descartarPendente, enfileirarTurno, marcarEsperaDaEquipe } from './fila'
import { ehMotivoTemporario, lerVoltaAposMin, voltaDaPausaEm } from './pausa'
import { abreTurno, lerQuemAtende, quemResponde, type ConteudoDaMensagem } from './quem-responde'
import { agendarTurno } from './turno'

export interface MensagemDoCliente {
  accountId: string
  conversationId: string
  /** A conexão GRAVADA na mensagem (`messages.channel_id`); nula = sem IA. */
  canalGravado: string | null
  /** `messages.id` (uuid) da mensagem do cliente. */
  mensagemId: string
  /** `messages.content_type`. */
  tipo: string
  /** `messages.content_text`, como GRAVADO. */
  texto: string | null
  /**
   * `messages.media_type`, como GRAVADO no insert — é o que separa a
   * figurinha (gravada como `image`) de uma foto. Ver `abreTurno`.
   */
  mime: string | null
  ehGrupo: boolean
  /** Toque em botão de modelo (Meta): não abre turno. */
  ehRespostaDeBotao: boolean
  /** Um fluxo (robô) consumiu a mensagem. */
  roboConsumiu: boolean
  /** Alguma automação desta mensagem FALOU (ou vai falar) com o contato (E4). */
  automacaoFalou: boolean
}

export async function aoChegarMensagemDoCliente(m: MensagemDoCliente): Promise<void> {
  if (m.ehGrupo || !m.canalGravado) return
  const canalId = m.canalGravado
  // O robô ou uma automação JÁ respondeu a esta mensagem: ela não abre turno,
  // e o turno desta conexão (o texto de antes, na mesma rajada) sai — o
  // PENDENTE e o que já RODA sem ter reservado o envio —, senão o cliente que
  // escreve e toca num botão recebe a resposta da automação e, 8 s depois, a
  // do agente. Uma escrita só, sem leitura.
  if (m.roboConsumiu || m.automacaoFalou) {
    try {
      await descartarPendente(supabaseAdmin(), { accountId: m.accountId, conversationId: m.conversationId, canalId })
    } catch (err) {
      console.error('[ia-agentes] descartar o pendente na entrada falhou:', err)
    }
    return
  }
  // Os portões de conteúdo, sem banco. `abreTurno` é a MESMA régua com que o
  // turno decide se uma mensagem mais nova o descarta (E10).
  const conteudo: ConteudoDaMensagem = { tipo: m.tipo, texto: m.texto, mime: m.mime }
  if (m.ehRespostaDeBotao || !abreTurno(conteudo)) return
  try {
    const db = supabaseAdmin()
    const leitura = await lerQuemAtende(db, { accountId: m.accountId, conversationId: m.conversationId, canalId })
    if (!leitura) return
    // A PAUSA TEMPORÁRIA (1138): com N > 0 na conta, a pausa `gente`/`botao`
    // não cala — o turno nasce para quando a cliente estiver esperando há N
    // min, e a resposta da equipe o descarta. Leitura da configuração que
    // falha LANÇA: a conversa fica pausada (o lado que não fala por cima da
    // equipe), e a próxima mensagem pergunta de novo.
    const minutos =
      leitura.pausada && ehMotivoTemporario(leitura.pausadaPor) ? await lerVoltaAposMin(db, m.accountId) : 0
    const decisao = quemResponde({
      ...leitura,
      canalId,
      conteudo,
      ehRespostaDeBotao: m.ehRespostaDeBotao,
      roboConsumiu: false,
      automacaoFalou: false,
      pausaTemporaria: minutos > 0,
    })
    if (decisao.quem !== 'agente') return

    const agora = Date.now()
    const esperaMs = decisao.sobrePausa
      ? voltaDaPausaEm({ agora, aguardandoDesde: leitura.aguardandoDesde, pausadaEm: leitura.pausadaEm, minutos }) - agora
      : undefined
    const turno = await enfileirarTurno(db, {
      accountId: m.accountId,
      conversationId: m.conversationId,
      canalId,
      iaAgenteId: decisao.agenteId,
      dealId: decisao.dealId,
      stageId: decisao.stageId,
      mensagemId: m.mensagemId,
      esperaMs,
    })
    if (!turno) return
    // A espera da equipe fica DITA na linha (a aba Turnos e a faixa a
    // reconhecem): a fila devolve a linha limpa a cada mensagem.
    if (decisao.sobrePausa) await marcarEsperaDaEquipe(db, turno.id)
    agendarTurno(turno)
  } catch (err) {
    console.error('[ia-agentes] a entrada da mensagem falhou:', err)
  }
}

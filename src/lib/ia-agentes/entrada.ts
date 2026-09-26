// ============================================================
// A PORTA da ingestão para os agentes de IA (docs/PLANO-agentes-de-ia.md,
// 5.3 e 5.7). A ingestão chama `aoChegarMensagemDoCliente` DEPOIS do robô e
// das automações; aqui se leem os fatos, a regra pura (`quemResponde`)
// decide, e o turno é só ENFILEIRADO — quem executa é o disparo agendado
// (`turno.ts`) ou a rede do cron.
//
// ⚠️ Nunca lança e nunca espera o agente: a ingestão ainda tem o webhook de
// saída `message.received` e os itens seguintes do lote atrás dela.
// ⚠️ O caso comum é "nenhum agente": duas leituras curtas (conversa e
// conexão) e volta. Quando o robô ou uma automação respondeu, nenhuma
// leitura: um UPDATE que descarta o pendente da conexão, e volta.
// ============================================================

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { ehInstagram } from '@/lib/cb-channels/transporte'

import { descartarPendente, enfileirarTurno } from './fila'
import { abreTurno, quemResponde, type AgenteParaDecidir, type ConteudoDaMensagem } from './quem-responde'
import { obterAgente } from './repo'
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

function paraDecidir(a: Awaited<ReturnType<typeof obterAgente>>): AgenteParaDecidir | null {
  return a ? { id: a.id, ativo: a.ativo, arquivado: a.arquivadoEm !== null, conexoes: a.conexoes } : null
}

export async function aoChegarMensagemDoCliente(m: MensagemDoCliente): Promise<void> {
  if (m.ehGrupo || !m.canalGravado) return
  const canalId = m.canalGravado
  // O robô ou uma automação JÁ respondeu a esta mensagem: ela não abre turno,
  // e o PENDENTE desta conexão (o texto de antes, na mesma rajada) sai — senão
  // o cliente que escreve e toca num botão recebe a resposta da automação e,
  // 8 s depois, a do agente (Codex, #292). Uma escrita só, sem leitura; e só
  // quando alguém de fato falou: figurinha ou botão SEM automação falando não
  // cancelam nada.
  if (m.roboConsumiu || m.automacaoFalou) {
    try {
      await descartarPendente(supabaseAdmin(), { accountId: m.accountId, conversationId: m.conversationId, canalId })
    } catch (err) {
      console.error('[ia-agentes] descartar o pendente na entrada falhou:', err)
    }
    return
  }
  // Os portões de conteúdo, sem banco. `abreTurno` é a MESMA régua com que o
  // turno decide se uma mensagem mais nova o descarta (E10): figurinha e
  // texto sem nada visível (cartão de contato, enquete, botão na Evolution)
  // não abrem turno.
  const conteudo: ConteudoDaMensagem = { tipo: m.tipo, texto: m.texto, mime: m.mime }
  if (m.ehRespostaDeBotao || !abreTurno(conteudo)) return
  try {
    const db = supabaseAdmin()
    const [{ data: conv, error: erroConv }, { data: canal, error: erroCanal }] = await Promise.all([
      db
        .from('conversations')
        .select('id, contact_id, group_id, status, ia_agente_id, ai_autoreply_disabled, created_at')
        .eq('id', m.conversationId)
        .eq('account_id', m.accountId)
        .maybeSingle(),
      db
        .from('cb_channels')
        .select('id, kind, ia_agente_entrada_id, ia_agente_entrada_desde')
        .eq('id', canalId)
        .eq('account_id', m.accountId)
        .maybeSingle(),
    ])
    if (erroConv || erroCanal) {
      console.error('[ia-agentes] leitura da conversa/conexão falhou:', erroConv?.message ?? erroCanal?.message)
      return
    }
    if (!conv || !canal) return
    // Uma automação desta mensagem pode ter ENCERRADO a conversa sem "falar"
    // (`close_conversation`, depois da reabertura da ingestão): o agente não
    // responde numa conversa fechada (Codex, #292).
    if (conv.status === 'closed') return
    // O caso comum: nenhum agente em lugar nenhum.
    if (!conv.ia_agente_id && !canal.ia_agente_entrada_id) return

    const agenteAtivo = conv.ia_agente_id ? paraDecidir(await obterAgente(m.accountId, conv.ia_agente_id)) : null

    // A entrada só é candidata sem agente ativo (regra 5): só então valem as
    // leituras da D16 e da P8.
    let entrada: { agente: AgenteParaDecidir; desde: string | null } | null = null
    let nuncaTeveGente = false
    let contatoCriadoEm: string | null = null
    if (!conv.ia_agente_id && canal.ia_agente_entrada_id) {
      const agente = paraDecidir(await obterAgente(m.accountId, canal.ia_agente_entrada_id))
      if (agente) {
        entrada = { agente, desde: canal.ia_agente_entrada_desde ?? null }
        // D16: NENHUMA mensagem de gente na conversa, em qualquer conexão,
        // apagada inclusive.
        const [{ data: gente, error: erroGente }, { data: contato, error: erroContato }] = await Promise.all([
          db
            .from('messages')
            .select('id')
            .eq('conversation_id', m.conversationId)
            .eq('sender_type', 'agent')
            .or('sender_id.not.is.null,from_device.is.true')
            .limit(1),
          conv.contact_id
            ? db.from('contacts').select('created_at').eq('id', conv.contact_id).eq('account_id', m.accountId).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ])
        // Leitura que falha NÃO vira "nunca teve gente": na dúvida, a entrada
        // não atende (o lado que atende menos gente).
        if (erroGente || erroContato) {
          console.error('[ia-agentes] leitura da D16/P8 falhou:', erroGente?.message ?? erroContato?.message)
          return
        }
        nuncaTeveGente = (gente?.length ?? 0) === 0
        contatoCriadoEm = (contato as { created_at?: string } | null)?.created_at ?? null
      }
    }

    const decisao = quemResponde({
      ehGrupo: conv.group_id !== null,
      ehInstagram: ehInstagram({ kind: canal.kind }),
      canalId,
      conteudo,
      ehRespostaDeBotao: m.ehRespostaDeBotao,
      roboConsumiu: m.roboConsumiu,
      automacaoFalou: m.automacaoFalou,
      pausada: conv.ai_autoreply_disabled === true,
      agenteAtivo,
      entrada,
      nuncaTeveGente,
      contatoCriadoEm,
      conversaCriadaEm: (conv as { created_at?: string | null }).created_at ?? null,
    })
    if (decisao.quem !== 'agente') return

    if (decisao.via === 'entrada') {
      // O agente de entrada vira o ATIVO da conversa, pela mesma RPC da
      // automação (a D17 decidida no banco, com a conversa travada).
      // ⚠️ SÓ SE A CONVERSA AINDA NÃO TEM AGENTE (`p_so_se_vazio`): a leitura
      // acima é uma foto, e entre ela e a atribuição outra frente (a régua do
      // Asaas, o passo "Atribuir agente" de uma automação) pode ter posto um
      // especialista. A entrada é o recepcionista de quem ainda não tem
      // ninguém — passar por cima tiraria a conversa do especialista em
      // silêncio. A RPC confere na linha TRAVADA e devolve `ocupada` sem
      // escrever nada; aí a entrada desiste, sem enfileirar (o agente que já
      // está lá responde às próximas mensagens pela regra do agente ativo).
      const { data, error } = await db.rpc('cb_atribuir_agente_de_ia', {
        p_account_id: m.accountId,
        p_conversation_id: m.conversationId,
        p_ia_agente_id: decisao.agenteId,
        p_canal_id: canalId,
        p_so_se_vazio: true,
      })
      if (error) {
        console.error('[ia-agentes] atribuir o agente de entrada falhou:', error.message)
        return
      }
      const resultado = (Array.isArray(data) ? data[0] : data) as { resultado?: string } | null
      // Só `retomada` enfileira. `ocupada` (outra frente atribuiu no meio),
      // as pausas, `agente_indisponivel` e `sem_conversa`: nada a responder.
      if (resultado?.resultado !== 'retomada') return
    }

    const turno = await enfileirarTurno(db, {
      accountId: m.accountId,
      conversationId: m.conversationId,
      canalId,
      iaAgenteId: decisao.agenteId,
      mensagemId: m.mensagemId,
    })
    if (turno) agendarTurno(turno)
  } catch (err) {
    console.error('[ia-agentes] a entrada da mensagem falhou:', err)
  }
}

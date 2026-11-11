// ============================================================
// A conversa que o agente lê (docs/PLANO-agentes-de-ia.md, 5.5, D4, E9).
//
// ⚠️ SÓ a conexão do turno (D4): uma conversa por contato corre por várias
// conexões, e o agente lê só a dele. Mensagem sem carimbo de conexão
// (histórico anterior ao multi-canal) NÃO entra — atribuí-la a uma conexão
// seria inventar. Sem as apagadas. Áudio pela TRANSCRIÇÃO; imagem e documento
// pela LEITURA (`transcricao*`, gravada por `src/lib/transcricao/ler-midia.ts`
// no turno), com a legenda; vídeo como descrição.
//
// ⚠️⚠️ A imagem e o documento do CLIENTE levam SEMPRE o estado da leitura, e
// são TRÊS estados com instruções opostas no pedido (`pedido.ts`):
//  - lida: `[image] legenda` + `(content: …)` na linha de baixo, com teto
//    (`TETO_DA_LEITURA_NO_CONTEXTO`) e o corte declarado — um PDF de 12.000
//    caracteres em cada turno encheria a janela do modelo;
//  - `— could not be read: <motivo>`: tentada e recusada DE VEZ (a recusa
//    gravada) ou, nesta rodada, sem chave que a leia (`semLeitor`, com o
//    motivo genérico — o da equipe manda às Integrações e não vai ao modelo).
//    O agente pede ao cliente que descreva ou reenvie;
//  - `— not read yet`: todo o resto (nunca tentada, falha passageira, além do
//    teto por turno). O agente NÃO pede reenvio — ela ainda vai ser lida.
//    Sem essa distinção, a quarta foto de uma rajada virava "mande de novo".
// A figurinha é `[sticker]` (nada a ler — `ehFigurinha`, a régua da
// entrada). A mídia da EQUIPE fica só com o rótulo: ninguém a lê.
//
// ⚠️ A ligação pelo CRM TRANSCRITA (4d, D11) entra como NOTA no papel de
// usuário ("not a message from the customer", a forma de
// `NOTA_DA_RESPOSTA_CRUZADA`): o diálogo tem as DUAS vozes, e no papel do
// assistente o modelo o tomaria por fala própria. O resumo vem primeiro e o
// diálogo é cortado no teto da leitura; passados os 180 dias, só o resumo. A
// ligação sem transcrição segue fora (não tem texto). Continua sem abrir turno.
//
// `montarConversa` é PURA (testada); `lerConversaDaConexao` é o I/O.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { removerAssinatura } from '@/lib/assinatura/assinatura'
import { aiContextMessageLimit } from '@/lib/ai/defaults'
import type { ChatMessage } from '@/lib/ai/types'
import { dialogoEmTexto } from '@/lib/whatsapp/ligacoes/dialogo'
import { lerDialogos, type DialogoGravado } from '@/lib/whatsapp/ligacoes/dialogos-gravados'

import { ehFigurinha } from './quem-responde'

/** O pedaço de `messages.ligacao` que o contexto lê (`DetalhesDaLigacao`). */
export interface LigacaoNoContexto {
  pelo_crm?: boolean
  ligacao_id?: string
  direcao?: string
  duracao_seg?: number | null
  transcricao?: string | null
  expirada?: boolean
}

export interface MensagemDoContexto {
  id?: string
  sender_type: 'customer' | 'agent' | 'bot' | string
  content_type: string
  content_text: string | null
  media_type?: string | null
  media_filename?: string | null
  transcricao?: string | null
  transcricao_status?: string | null
  transcricao_erro?: string | null
  ligacao?: LigacaoNoContexto | null
}

/** Teto da leitura de uma imagem ou documento no pedido, em caracteres. */
export const TETO_DA_LEITURA_NO_CONTEXTO = 4_000
/** Teto do motivo da recusa no rótulo. */
const TETO_DO_MOTIVO = 120
/**
 * O motivo que o MODELO vê quando nenhuma chave cadastrada lê o arquivo
 * agora (`sem_leitor`). Genérico de propósito: o motivo da equipe ("cadastre
 * uma chave em Configurações → Integrações") não é assunto do cliente.
 */
export const MOTIVO_SEM_LEITOR = 'o sistema não consegue ler este tipo de arquivo agora'

/** O texto LIDO da mídia (pronta), com teto e corte declarado; `''` = não há. */
function lida(m: MensagemDoContexto): string {
  if (m.transcricao_status !== 'pronta') return ''
  const t = (m.transcricao ?? '').trim()
  if (t.length <= TETO_DA_LEITURA_NO_CONTEXTO) return t
  return `${t.slice(0, TETO_DA_LEITURA_NO_CONTEXTO).trimEnd()} […cut]`
}

/** O motivo da recusa GRAVADA, curto; `null` = não foi recusada. */
function recusa(m: MensagemDoContexto): string | null {
  if (m.transcricao_status !== 'recusada') return null
  const motivo = (m.transcricao_erro ?? '').replace(/\s+/g, ' ').trim()
  if (!motivo) return 'unknown reason'
  return motivo.length > TETO_DO_MOTIVO ? `${motivo.slice(0, TETO_DO_MOTIVO).trimEnd()}…` : motivo
}

/**
 * `[rótulo — estado] legenda` e, com a leitura, `(content: …)` na linha de
 * baixo. Só a mídia do CLIENTE leva o estado (é a única que se lê).
 */
function comLeitura(rotulo: string, legenda: string, m: MensagemDoContexto, semLeitor?: ReadonlySet<string>): string {
  const conteudo = m.sender_type === 'customer' ? lida(m) : ''
  let cabeca = rotulo
  if (m.sender_type === 'customer' && !conteudo) {
    const motivo = recusa(m) ?? (m.id && semLeitor?.has(m.id) ? MOTIVO_SEM_LEITOR : null)
    cabeca = `${rotulo.slice(0, -1)} — ${motivo ? `could not be read: ${motivo}` : 'not read yet'}]`
  }
  const base = legenda ? `${cabeca} ${legenda}` : cabeca
  return conteudo ? `${base}\n(content: ${conteudo})` : base
}

/** A ligação pelo CRM com diálogo ou resumo (D11); `null` = fica fora. */
function ligacaoComDialogo(m: MensagemDoContexto, dialogos?: ReadonlyMap<string, DialogoGravado>): DialogoGravado | null {
  const l = m.ligacao
  if (m.content_type !== 'call' || l?.pelo_crm !== true || !l.ligacao_id) return null
  const d = dialogos?.get(l.ligacao_id)
  return d && (d.resumo || d.trechos.length > 0) ? d : null
}

/** A nota da ligação transcrita: cabeça, resumo e o diálogo com teto. */
function descreverLigacao(m: MensagemDoContexto, d: DialogoGravado): string {
  const l = m.ligacao ?? {}
  const minutos = typeof l.duracao_seg === 'number' && l.duracao_seg > 0 ? Math.max(1, Math.round(l.duracao_seg / 60)) : null
  const quem = l.direcao === 'recebida' ? 'from the customer, answered by the business' : 'to the customer, made by the business'
  const cabeca =
    `[System note, not a message from the customer: phone call ${quem} through the CRM` +
    `${minutos ? `, about ${minutos} min` : ''}.]`
  const partes: string[] = []
  if (d.resumo) partes.push(`Summary: ${d.resumo}`)
  if (d.trechos.length > 0) {
    partes.push(
      `Transcript (automatic, may contain errors):\n${dialogoEmTexto(d.trechos, { cliente: 'Customer', atendente: 'Business' })}`,
    )
  }
  const corpo = partes.join('\n')
  const cortado =
    corpo.length > TETO_DA_LEITURA_NO_CONTEXTO ? `${corpo.slice(0, TETO_DA_LEITURA_NO_CONTEXTO).trimEnd()} […cut]` : corpo
  return `${cabeca}\n${cortado}`
}

function descrever(m: MensagemDoContexto, semLeitor?: ReadonlySet<string>): string {
  const texto = (removerAssinatura(m.content_text) ?? '').trim()
  switch (m.content_type) {
    case 'text':
      return texto
    case 'audio': {
      const ouvida = m.transcricao_status === 'pronta' ? (m.transcricao ?? '').trim() : ''
      return ouvida ? `[audio message, transcribed] ${ouvida}` : '[audio message, not transcribed]'
    }
    case 'image':
      // A figurinha é gravada como `image` (o CHECK não tem `sticker`).
      if (ehFigurinha(m.content_type, m.media_type)) return '[sticker]'
      return comLeitura('[image]', texto, m, semLeitor)
    case 'video':
      return texto ? `[video] ${texto}` : '[video]'
    case 'document': {
      const nome = (m.media_filename ?? '').trim()
      const rotulo = nome ? `[document: ${nome}]` : '[document]'
      // Nas linhas antigas da Meta o nome está DENTRO do texto: não repetir.
      return comLeitura(rotulo, texto && texto !== nome ? texto : '', m, semLeitor)
    }
    case 'sticker':
      return '[sticker]'
    case 'location':
      return '[location]'
    default:
      return texto
  }
}

/**
 * As linhas (mais antigas primeiro) → o formato neutro dos provedores.
 * `semLeitor`: os ids das mídias que, NESTA rodada, nenhuma chave cadastrada
 * lê (`prepararMidias`) — nada gravado, mas o agente não as verá.
 * `dialogos`: as ligações pelo CRM transcritas, por `ligacao_id` (4d).
 */
export function montarConversa(
  linhas: MensagemDoContexto[],
  semLeitor?: ReadonlySet<string>,
  dialogos?: ReadonlyMap<string, DialogoGravado>,
): ChatMessage[] {
  return linhas
    .map((m) => {
      const ligacao = ligacaoComDialogo(m, dialogos)
      if (ligacao) return { role: 'user' as ChatMessage['role'], content: descreverLigacao(m, ligacao) }
      return {
        role: (m.sender_type === 'customer' ? 'user' : 'assistant') as ChatMessage['role'],
        content: descrever(m, semLeitor),
      }
    })
    .filter((m) => m.content.length > 0)
}

/**
 * Fecha com o CLIENTE a conversa que termina na fala da empresa (revisão de
 * 09/11/2026). A conversa segue a ordem em que as mensagens aconteceram
 * (`created_at`, o relógio do WhatsApp): a mensagem que o cliente escreveu
 * enquanto o agente respondia — e que chegou ao CRM depois da reserva — fica
 * ANTES da resposta, e o turno dela mandaria ao modelo uma conversa terminando
 * no turno do modelo. O Gemini a recusa ("Requests ending with a model turn
 * are not supported", medido em 27/09/2026: o cliente ficava sem resposta) e
 * a Anthropic CONTINUA o texto anterior do agente, ignorando a pergunta nova.
 * Medido: ~1% das mensagens de cliente chegam assim. A nota, no papel de
 * usuário, diz que não é o cliente — a forma de `comNotaDaRetomada`. Conversa
 * sem nenhuma fala do cliente fica como está (`comecarNoCliente`, no
 * adaptador, cuida dela).
 */
/**
 * O começo de toda NOTA do sistema no papel de usuário (a resposta cruzada, a
 * ligação transcrita): não é fala do cliente. Quem procura o que o CLIENTE
 * disse (a origem do nome da reunião, `nomeComOrigem`) as tira por aqui — a
 * nota da ligação traz a fala da empresa e o resumo feito pela IA.
 */
export const PREFIXO_DA_NOTA = '[System note, not a message from the customer'

export function ehNotaDoSistema(texto: string): boolean {
  return texto.startsWith(PREFIXO_DA_NOTA)
}

export const NOTA_DA_RESPOSTA_CRUZADA =
  "[System note, not a message from the customer: the business's last message(s) above crossed with the customer's " +
  "latest message — the customer wrote before seeing them. Reply to what the customer still needs, without repeating what the business already said.]"

export function terminarNoCliente(mensagens: readonly ChatMessage[]): ChatMessage[] {
  const ultima = mensagens[mensagens.length - 1]
  if (!ultima || ultima.role === 'user' || !mensagens.some((m) => m.role === 'user')) return [...mensagens]
  return [...mensagens, { role: 'user', content: NOTA_DA_RESPOSTA_CRUZADA }]
}

/**
 * As últimas N mensagens DESTA conexão, sem as apagadas, na ordem em que
 * aconteceram. Lança em erro de leitura (o turno registra `falhou`).
 */
export async function lerConversaDaConexao(
  db: SupabaseClient,
  args: { conversationId: string; canalId: string; limite?: number; semLeitor?: ReadonlySet<string> },
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select(
      'id, sender_type, content_type, content_text, media_type, media_filename, transcricao, transcricao_status, transcricao_erro, ligacao',
    )
    .eq('conversation_id', args.conversationId)
    .eq('channel_id', args.canalId)
    .is('deleted_at', null)
    // O que NÃO saiu (1080) o cliente nunca leu: o agente não pode "lembrar".
    .eq('nao_saiu', false)
    .order('created_at', { ascending: false })
    .limit(args.limite ?? aiContextMessageLimit())
  if (error) throw new Error(`[ia-agentes] leitura da conversa falhou: ${error.message}`)
  const linhas = ((data ?? []) as MensagemDoContexto[]).reverse()
  // As ligações pelo CRM transcritas (4d): melhor esforço — a leitura que
  // falha deixa o agente sem elas, como a base de conhecimento.
  const ids = linhas
    .filter(
      (m) =>
        m.content_type === 'call' &&
        m.ligacao?.pelo_crm === true &&
        !!m.ligacao.ligacao_id &&
        (m.ligacao.transcricao === 'pronta' || m.ligacao.expirada === true),
    )
    .map((m) => m.ligacao?.ligacao_id as string)
  const dialogos = ids.length > 0 ? await lerDialogos(db, args.conversationId, ids) : null
  if (ids.length > 0 && !dialogos) console.error('[ia-agentes] os diálogos das ligações não vieram; seguem fora')
  return montarConversa(linhas, args.semLeitor, dialogos ?? undefined)
}

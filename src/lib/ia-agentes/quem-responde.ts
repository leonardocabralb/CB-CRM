// ============================================================
// QUEM RESPONDE a mensagem do cliente (docs/PLANO-agentes-de-ia.md, 5.3, e
// as decisões da execução da F2). PURO, testado — a ingestão lê os fatos e
// esta função decide; o turno confere tudo de novo antes de gerar.
//
// A ordem das regras É a regra:
//   0. fora do alcance (grupo, Instagram, sem conexão, tipo de mensagem que
//      não abre turno) → ninguém;
//   1. o robô consumiu a mensagem → ninguém;
//   2. uma automação desta mensagem FALOU (ou vai falar) com o contato
//      (`ResultadoDoDisparo.falou`, E4) → ninguém: o cliente não recebe
//      duas respostas;
//   3. a conversa está pausada → ninguém;
//   4. há AGENTE ATIVO, ligado, e a conexão da mensagem é dele → ele. O
//      responsável humano NÃO cala o agente ativo (a atribuição deixou de ser
//      portão);
//   5. a conversa NÃO tem agente ativo, a conexão tem AGENTE DE ENTRADA,
//      ligado e dono da conexão, a conversa NUNCA recebeu resposta de gente
//      (D16) e o contato foi criado DEPOIS de a entrada ser ligada (P8, E3) →
//      ele, e ele vira o agente ativo. ⚠️ Com agente ativo que não pode
//      responder (desligado, ou a mensagem veio por outra conexão), a entrada
//      NÃO o substitui: desligar o especialista pararia de funcionar como
//      freio, e o cliente que escreve para outro número trocaria o agente da
//      conversa inteira sem ninguém decidir (Codex, #292);
//   6. senão → ninguém.
// ============================================================

/** Tipos de mensagem que abrem turno (E9). Figurinha, localização, contato e toque em botão não. */
export const TIPOS_QUE_ABREM_TURNO: ReadonlySet<string> = new Set(['text', 'audio', 'image', 'document', 'video'])

export interface AgenteParaDecidir {
  id: string
  ativo: boolean
  arquivado: boolean
  conexoes: readonly string[]
}

export interface FatosDaMensagem {
  ehGrupo: boolean
  /** A conexão é do Instagram (o agente não responde no Direct, D1 do Instagram). */
  ehInstagram: boolean
  /** A conexão que ficou gravada na mensagem (nula = sem IA). */
  canalId: string | null
  tipoDaMensagem: string
  /** Toque em botão de modelo (Meta): não abre turno (a regra de hoje). */
  ehRespostaDeBotao: boolean
  roboConsumiu: boolean
  automacaoFalou: boolean
  /** `conversations.ai_autoreply_disabled`. */
  pausada: boolean
  /** O agente ATIVO da conversa (`conversations.ia_agente_id`), lido. Nulo = nenhum. */
  agenteAtivo: AgenteParaDecidir | null
  /** O agente de ENTRADA da conexão e desde quando ela está ligada. */
  entrada: { agente: AgenteParaDecidir; desde: string | null } | null
  /** D16: a conversa NUNCA teve mensagem de gente (`sender_id` ou `from_device`), apagada inclusive. */
  nuncaTeveGente: boolean
  /** `contacts.created_at` do contato (P8). */
  contatoCriadoEm: string | null
}

export type QuemResponde =
  | { quem: 'ninguem'; motivo: MotivoDeNinguem }
  | { quem: 'agente'; agenteId: string; via: 'ativo' | 'entrada' }

export type MotivoDeNinguem =
  | 'fora_do_alcance'
  | 'robo'
  | 'automacao'
  | 'pausada'
  /** Há agente ativo, mas ele não responde aqui (desligado ou fora da conexão). */
  | 'agente_ativo_indisponivel'
  | 'sem_agente'

function atende(agente: AgenteParaDecidir, canalId: string): boolean {
  return agente.ativo && !agente.arquivado && agente.conexoes.includes(canalId)
}

function instante(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function quemResponde(f: FatosDaMensagem): QuemResponde {
  if (
    f.ehGrupo ||
    f.ehInstagram ||
    !f.canalId ||
    f.ehRespostaDeBotao ||
    !TIPOS_QUE_ABREM_TURNO.has(f.tipoDaMensagem)
  ) {
    return { quem: 'ninguem', motivo: 'fora_do_alcance' }
  }
  if (f.roboConsumiu) return { quem: 'ninguem', motivo: 'robo' }
  if (f.automacaoFalou) return { quem: 'ninguem', motivo: 'automacao' }
  if (f.pausada) return { quem: 'ninguem', motivo: 'pausada' }

  if (f.agenteAtivo) {
    if (atende(f.agenteAtivo, f.canalId)) return { quem: 'agente', agenteId: f.agenteAtivo.id, via: 'ativo' }
    return { quem: 'ninguem', motivo: 'agente_ativo_indisponivel' }
  }

  if (f.entrada && atende(f.entrada.agente, f.canalId) && f.nuncaTeveGente) {
    // P8 (E3): só contato criado DEPOIS de a entrada ser ligada. Sem o
    // carimbo (não deveria acontecer: o banco o grava) ou sem a data do
    // contato, NÃO atende — o lado que atende menos gente.
    const desde = instante(f.entrada.desde)
    const criado = instante(f.contatoCriadoEm)
    if (desde !== null && criado !== null && criado >= desde) {
      return { quem: 'agente', agenteId: f.entrada.agente.id, via: 'entrada' }
    }
  }

  return { quem: 'ninguem', motivo: 'sem_agente' }
}

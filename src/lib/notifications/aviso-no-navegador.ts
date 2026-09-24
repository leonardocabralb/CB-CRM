import type { Conversation } from "@/types";
import { conversaNoEscopo } from "@/lib/perfis/escopo";
import type { ContextoDeAcesso } from "@/lib/perfis/tipos";
import { podeVerTela } from "@/lib/perfis/visibilidade";

// ============================================================
// Notificação do navegador (#516 do original, Fase 8 do plano do merge do
// upstream): o que é NOSSO em cima da biblioteca dele.
//
// A régua do original avisa TODA mensagem de cliente da conta. Aqui, por
// decisão do operador (P2, 24/09/2026):
// - só as conexões do PERFIL de quem recebe (a régua do Meu dia, com o
//   contexto REAL — nunca a lente do "Ver como": quem simula continua sendo
//   o admin, e é ele quem recebe o aviso);
// - grupo fica de fora (mensagem de grupo é conversa da equipe inteira, e um
//   grupo movimentado enterraria o aviso de cliente);
// - a pessoa desliga e CONFIGURA: quais conversas e se o texto aparece.
//
// E um recorte que o original não precisa: mensagem ANTIGA gravada agora
// (a carga do histórico da Kommo, a fala recuperada horas depois pela 1010)
// não avisa — sem ele, uma carga em lote com a aba aberta despejaria um
// aviso por conversa.
// ============================================================

/** Quais conversas avisam. Escopo do perfil vale nas três. */
export type QuaisConversas = "todas" | "minhas_e_sem_responsavel" | "minhas";

export const QUAIS_CONVERSAS: readonly QuaisConversas[] = [
  "todas",
  "minhas_e_sem_responsavel",
  "minhas",
];

export interface PreferenciaDeAviso {
  ativo: boolean;
  quais: QuaisConversas;
  /** Desligado, o aviso diz só QUEM escreveu (tela à vista de outras pessoas). */
  mostrarTexto: boolean;
}

export const PREFERENCIA_PADRAO: PreferenciaDeAviso = {
  ativo: false,
  quais: "todas",
  mostrarTexto: true,
};

/**
 * ⚠️ A chave é POR PESSOA, e não a global do original
 * (`wacrm:browser-notifications`): num computador compartilhado, quem
 * entrasse depois herdaria o "ligado" de quem ligou — e receberia os avisos
 * das conexões do perfil DELE, com a permissão do navegador dada pelo outro.
 * Trocar a chave zera o opt-in feito pelo cartão do #259, que nunca mandou
 * aviso nenhum (o ouvinte não estava montado).
 */
export function chaveDaPreferencia(userId: string): string {
  return `cb-notificacoes:${userId}`;
}

/** A chave do original, apagada quando a pessoa grava a nova. */
export const CHAVE_ANTIGA = "wacrm:browser-notifications";

/**
 * PARSE, nunca `as`: a linha vem do localStorage e pode ter sido gravada por
 * outra versão. Booleano só liga com `true` (`"false"` e `1` são truthy).
 */
export function lerPreferencia(texto: string | null): PreferenciaDeAviso {
  if (!texto) return PREFERENCIA_PADRAO;
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return PREFERENCIA_PADRAO;
  }
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return PREFERENCIA_PADRAO;
  }
  const o = bruto as Record<string, unknown>;
  return {
    ativo: o.ativo === true,
    quais: QUAIS_CONVERSAS.includes(o.quais as QuaisConversas)
      ? (o.quais as QuaisConversas)
      : PREFERENCIA_PADRAO.quais,
    mostrarTexto:
      typeof o.mostrarTexto === "boolean" ? o.mostrarTexto : PREFERENCIA_PADRAO.mostrarTexto,
  };
}

/**
 * Mensagem gravada mais de 1 h depois do próprio carimbo é HISTÓRIA, não
 * mensagem nova: a carga da Kommo grava conversas de meses atrás, e a fala
 * recuperada pela 1010 pode chegar horas depois. Os episódios de atraso de
 * entrega da Evolution medidos até aqui ficaram abaixo de 1 h (9 a 50 min) —
 * ali o cliente ESTÁ esperando, e o aviso tem de sair.
 */
export const LIMITE_DE_ATRASO_MS = 60 * 60 * 1000;

/** O que a decisão lê da mensagem (o `payload.new` do realtime). */
export interface MensagemDoAviso {
  created_at: string;
  /** O `now()` da gravação (1003). Nulo na carga antiga: cai no relógio da tela. */
  gravada_em?: string | null;
}

/** O que a decisão lê da conversa (a consulta do ouvinte). */
export type ConversaDoAviso = Pick<
  Conversation,
  "id" | "channel_id" | "group_id" | "group" | "assigned_agent_id"
>;

export type SilencioDoAviso =
  | "sem_caixa_de_entrada"
  | "grupo"
  | "fora_do_perfil"
  | "nao_e_sua"
  | "antiga";

/**
 * A mensagem de cliente (já filtrada pela régua do original: remetente,
 * repetição e conversa aberta na tela) cabe num aviso para ESTA pessoa?
 * Devolve o motivo do silêncio, ou `null` quando avisa.
 */
export function silencioDoAviso(args: {
  mensagem: MensagemDoAviso;
  conversa: ConversaDoAviso;
  /** O contexto REAL (`{ papel: profile.account_role, perfil: perfilDeAcesso }`). */
  ctx: ContextoDeAcesso;
  userId: string;
  quais: QuaisConversas;
  agoraMs: number;
}): SilencioDoAviso | null {
  const { mensagem, conversa, ctx, userId, quais, agoraMs } = args;

  // O clique leva à caixa de entrada: perfil sem ela cairia na TelaBloqueada.
  if (!podeVerTela(ctx, "inbox")) return "sem_caixa_de_entrada";
  if (conversa.group_id) return "grupo";
  if (!conversaNoEscopo(ctx, conversa as Conversation)) return "fora_do_perfil";

  const dono = conversa.assigned_agent_id ?? null;
  if (quais === "minhas" && dono !== userId) return "nao_e_sua";
  if (quais === "minhas_e_sem_responsavel" && dono !== null && dono !== userId) {
    return "nao_e_sua";
  }

  const carimbo = Date.parse(mensagem.created_at);
  const gravada = mensagem.gravada_em ? Date.parse(mensagem.gravada_em) : NaN;
  const referencia = Number.isNaN(gravada) ? agoraMs : gravada;
  if (!Number.isNaN(carimbo) && referencia - carimbo > LIMITE_DE_ATRASO_MS) {
    return "antiga";
  }
  return null;
}

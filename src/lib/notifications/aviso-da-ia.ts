import type { NotificationType } from "@/types";

// ============================================================
// O aviso "IA passou a conversa para a equipe" (1139) na TELA — puro.
//
// Decisões do operador (11/11/2026, `docs/PLANO-aviso-da-ia-que-passa-a-conversa.md`):
// o aviso entra no sino como os outros e, SÓ ele, abre também uma caixinha
// clicável dentro do CRM (D4), que fica até a pessoa abrir a conversa ou
// fechar no X (D3). O pop-up do navegador continua para quem o ligou.
//
// Os dois avisos não podem gritar juntos: com a aba EM FOCO, a caixinha já
// está diante da pessoa — o pop-up do sistema cala para este tipo e o som do
// CRM sai pela caixinha. Fora de foco (outra janela, outro programa, aba
// escondida), o pop-up sai como os outros avisos do sino, com o som dele, e
// a caixinha espera na aba.
// ============================================================

/** O tipo do aviso na tabela `notifications` (o CHECK da 1139). */
export const TIPO_DO_AVISO_DA_IA = "ia_transferiu" satisfies NotificationType;

/** O alarme quando a IA para de responder (1140), que abre a caixinha VERMELHA. */
export const TIPO_DO_ALARME_DA_IA = "ia_falhou" satisfies NotificationType;

/**
 * Os tipos que abrem a caixinha dentro do CRM: a IA que passou a conversa
 * (âmbar) e o alarme de que ela parou (vermelho). O "voltou" (`ia_voltou`)
 * fica só no sino — é boa notícia, não pede ação.
 */
export const TIPOS_COM_CAIXINHA = [TIPO_DO_AVISO_DA_IA, TIPO_DO_ALARME_DA_IA] as const;

export function temCaixinha(tipo: NotificationType): boolean {
  return (TIPOS_COM_CAIXINHA as readonly NotificationType[]).includes(tipo);
}

/** O tom da caixinha: âmbar para a passagem (D5), vermelho para a falha (F1). */
export function tomDaCaixinha(tipo: NotificationType): "aviso" | "falha" {
  return tipo === TIPO_DO_ALARME_DA_IA ? "falha" : "aviso";
}

/** O alarme da IA e a volta dela levam às clientes "Em atraso" (1140). */
export function ehAlarmeDaIa(tipo: NotificationType | undefined): boolean {
  return tipo === "ia_falhou" || tipo === "ia_voltou";
}

/**
 * D6 do operador (12/11/2026): ao abrir o CRM (ou recarregar a página), voltam
 * as caixinhas dos avisos da IA ainda NÃO lidos destas últimas horas — antes,
 * recarregar a página as perdia e quem estava com o CRM fechado nunca as via.
 */
export const JANELA_DA_REABERTURA_MS = 24 * 60 * 60 * 1000;

/** No máximo estas voltam de uma vez (as mais recentes): o resto fica no sino. */
export const TETO_NA_REABERTURA = 5;

/** Desde quando os avisos não lidos voltam a abrir a caixinha (ISO). */
export function desdeDaReabertura(agoraMs: number): string {
  return new Date(agoraMs - JANELA_DA_REABERTURA_MS).toISOString();
}

/**
 * Os avisos lidos na abertura que voltam a abrir a caixinha, na ordem de
 * MOSTRAR (o mais antigo primeiro: o sonner põe o último no topo). ⚠️ Fora os
 * que o tempo real já disse LIDOS enquanto a consulta estava no ar (outra
 * aba, outro aparelho): a foto da consulta diria "não lido", e a caixinha
 * ficaria presa — nenhum UPDATE novo viria para fechá-la (Codex, #511).
 */
export function avisosParaReabrir<T extends { id: string }>(
  maisRecentesPrimeiro: readonly T[],
  lidosNoCaminho: ReadonlySet<string>,
): T[] {
  return [...maisRecentesPrimeiro].reverse().filter((a) => !lidosNoCaminho.has(a.id));
}

/** O `id` da caixinha no sonner: um por aviso, com prefixo próprio. */
export function idDaCaixinha(avisoId: string): string {
  return `ia:${avisoId}`;
}

/**
 * A aba está à vista E com o foco do teclado — a pessoa está olhando o CRM.
 * Lê o `document` (só no navegador); o resto deste arquivo é puro.
 */
export function abaEmFoco(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "visible" && document.hasFocus();
}

/**
 * O pop-up do SISTEMA (`useAvisosDoSinoNoNavegador`) cala para este aviso?
 * Só com a aba à vista E com o foco: aí a caixinha basta. Segundo monitor
 * sem foco conta como fora — a pessoa pode estar noutro programa.
 */
export function popUpDoSistemaCalaPelaCaixinha(tipo: NotificationType, emFoco: boolean): boolean {
  return temCaixinha(tipo) && emFoco;
}

/**
 * A caixinha toca o som do CRM? Só quando o pop-up do sistema NÃO vai sair
 * (aba em foco, ou pop-up impossível: chave do sino desligada, permissão
 * negada, aparelho de toque) — senão os dois tocariam. Respeita a chave
 * "Tocar o som do CRM" do sino (`somNoSino`).
 */
export function caixinhaTocaOSom(args: { somNoSino: boolean; abaEmFoco: boolean; popUpPossivel: boolean }): boolean {
  if (!args.somNoSino) return false;
  return args.abaEmFoco || !args.popUpPossivel;
}

/**
 * As caixinhas a fechar quando uma conversa é aberta na caixa de entrada:
 * quem abriu a conversa por outro caminho (a lista, o sino) já está nela.
 */
export function caixinhasDaConversa(
  abertas: ReadonlyMap<string, string | null>,
  conversaId: string,
): string[] {
  return [...abertas].filter(([, conversa]) => conversa === conversaId).map(([avisoId]) => avisoId);
}

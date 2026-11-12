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
  return tipo === TIPO_DO_AVISO_DA_IA && emFoco;
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

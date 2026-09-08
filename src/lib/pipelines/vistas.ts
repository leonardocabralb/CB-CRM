/**
 * Quais abas da tela de funis cada papel enxerga — puro, para a regra ser
 * testável e para a tela não decidir permissão no meio do JSX.
 *
 * ⚠️ Decisão do operador (2026-09-08, simulando o perfil "Bancário -
 * Jurídico"): as três leituras analíticas — Lista, Desempenho e Saúde —
 * são de administrador. Elas mostram a conta inteira (taxas de conversão,
 * valor fechado, ticket médio, investimento em anúncios, CAC), que é
 * informação de gestão do escritório. O Kanban continua de todo mundo: é
 * onde o atendente trabalha.
 *
 * ⚠️ Isto é RECORTE DE TELA, não barreira: `deals` e `cb_lead_events` são
 * legíveis por qualquer membro (017/912), e as três abas leem direto do
 * banco no navegador. Fechar de verdade exigiria rota server-side — e a
 * mesma tabela alimenta o Kanban do atendente, então não dá para resolver
 * com policy. Ver `canViewReports`.
 */

export const VISTAS_DO_FUNIL = ["leads", "lista", "desempenho", "saude", "automacoes"] as const;

export type VistaDoFunil = (typeof VISTAS_DO_FUNIL)[number];

/** O Kanban, que todo mundo que enxerga a tela de funis pode abrir. */
export const VISTA_PADRAO: VistaDoFunil = "leads";

export interface PoderesDoFunil {
  /** Lista, Desempenho e Saúde. */
  relatorios: boolean;
  /** A grade de automações (regra da Fase 2: automação é assunto de admin). */
  automacoes: boolean;
}

/** As abas a desenhar, na ordem da barra. */
export function vistasPermitidas(poderes: PoderesDoFunil): VistaDoFunil[] {
  return VISTAS_DO_FUNIL.filter((v) => {
    if (v === "leads") return true;
    if (v === "automacoes") return poderes.automacoes;
    return poderes.relatorios;
  });
}

/**
 * A aba a exibir AGORA.
 *
 * ⚠️ Resolvida no render, nunca guardada por efeito: a lente de simulação
 * de perfil troca o papel com a tela montada, e uma aba proibida que
 * sobrevivesse até o efeito rodar mostraria o Desempenho da conta inteira
 * a quem acabou de perder o acesso. Mesma família da armadilha do "efeito
 * passivo" que o CLAUDE.md documenta.
 */
export function vistaVigente(escolhida: VistaDoFunil, poderes: PoderesDoFunil): VistaDoFunil {
  return vistasPermitidas(poderes).includes(escolhida) ? escolhida : VISTA_PADRAO;
}

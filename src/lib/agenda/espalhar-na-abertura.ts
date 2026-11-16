// ============================================================
// O que fica para a ABERTURA da janela sai ESPALHADO pela primeira hora dela
// (decisão do operador, 16/11/2026). PURO, testado.
//
// Medido no Trabalhista (16/11/2026): os follow-ups da IA que venceram de
// noite saíram todos às 08:00, oito em 9 segundos, pela conexão de QR Code —
// rajada é o sinal de envio em massa que o WhatsApp pune. Abrir a janela
// 24 h acabaria com a rajada mandando mensagem de madrugada (o bloqueio e a
// denúncia pesam mais que ela); o operador escolheu manter as 8h–21h e
// espalhar: cada conversa (ou cliente, na automação) ganha um instante
// PRÓPRIO dentro de `ESPALHAR_NA_ABERTURA_MS` depois da abertura.
//
// ⚠️ Determinístico pela SEMENTE (nunca `Math.random`): o mesmo vencimento é
// recalculado ao armar e de novo ao rodar (a conferência que reagenda), e
// sortear de novo moveria o horário a cada conferência. Quem chama: a
// retomada dos agentes (`ia-agentes/retomada.ts`) e o "Aguardar até estar
// dentro do horário" das automações (`automations/hora-do-dia.ts`).
// ============================================================

/** A primeira hora depois da abertura ("entre 8h e 9h"). */
export const ESPALHAR_NA_ABERTURA_MS = 60 * 60_000

/**
 * Quanto depois da abertura sai o que tem esta `semente`: um instante em
 * `[0, larguraMs)`, em segundos inteiros, sempre o mesmo para a mesma
 * semente (FNV-1a de 32 bits sobre o texto). Largura de menos de 1 s = 0.
 */
export function deslocamentoNaAbertura(semente: string, larguraMs: number = ESPALHAR_NA_ABERTURA_MS): number {
  const segundos = Math.floor(larguraMs / 1000)
  if (segundos <= 0) return 0
  let h = 0x811c9dc5
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h % segundos) * 1000
}

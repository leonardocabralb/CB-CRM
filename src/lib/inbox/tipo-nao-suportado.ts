// ============================================================
// O rótulo do tipo de mensagem que a ingestão não sabe ler.
//
// O banco guarda `[Unsupported message type: <tipo>]` — a constante que o
// webhook da Meta sempre escreveu e que, desde a 1060, a Evolution também
// escreve no lugar da bolha vazia. É dado, não interface: a tela troca o
// rótulo por uma frase do dicionário (a bolha, a prévia da lista e o card do
// funil); a API v1 entrega o rótulo cru.
//
// ⚠️ A constante é a de `quem-responde.ts`, e não uma cópia: é ela que o
// agente de IA recusa em `abreTurno`. Uma segunda string divergiria na
// primeira edição e a tela voltaria a mostrar o rótulo em inglês.
// ============================================================

import { PREFIXO_DE_TIPO_NAO_SUPORTADO } from "@/lib/ia-agentes/quem-responde";

/**
 * O tipo nomeado no rótulo (`pollCreationMessageV3`, `contacts`…), ou null
 * quando o texto não é o rótulo. Rótulo sem nome de tipo devolve `''`.
 */
export function tipoNaoSuportado(texto: string | null | undefined): string | null {
  if (!texto || !texto.startsWith(PREFIXO_DE_TIPO_NAO_SUPORTADO)) return null;
  return texto.slice(PREFIXO_DE_TIPO_NAO_SUPORTADO.length).replace(/\]\s*$/, "").trim();
}

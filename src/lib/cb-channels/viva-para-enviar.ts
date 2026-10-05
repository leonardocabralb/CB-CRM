// ============================================================
// A sonda confirma que a conexão ENVIA? UMA régua para quem decide por ela:
// a régua de cobrança do Asaas (`varrer-regua.ts`, que pula a conexão que não
// prova envio) e a conversa (`message-thread.tsx`, que só manda "trocar o
// número" para um que serve — Codex, PR #386). Pura e sem dependência de
// servidor: o fio importa daqui, e `varrer-regua.ts` (que chama a sonda) não
// pode ir ao navegador. Duas cópias divergiriam no primeiro amarelo novo.
// ============================================================

/**
 * `ok` = o provedor respondeu `open` (ou o registro está fresco); `warn` só
 * serve quando o detalhe é de ENTRADA (`ENVIA_MESMO_EM_AMARELO`). `pairing`,
 * `stale` e `lastError` NÃO provam nada: travar o marco e tentar por elas
 * deixava a trava em `falhou` com a mensagem sem sair, e a trava única
 * impedia o ciclo seguinte de tentar (Codex, 2ª rodada do PR #206).
 */
export function vivaParaEnviar(c: { tone: string; detail: string | null }): boolean {
  return c.tone === 'ok' || (c.tone === 'warn' && ENVIA_MESMO_EM_AMARELO.has(c.detail ?? ''));
}

/**
 * Os amarelos que NÃO dizem nada sobre ENVIAR.
 *
 * ⚠️ `webhook` (a instância está aberta — o CRM é que está surdo) e `lagging`
 * (1002) descrevem a ENTRADA. Atraso de entrega mede quanto o WhatsApp
 * demorou para passar a mensagem do cliente à Evolution; o envio é outra
 * direção — uma chamada nossa ao provedor, que não espera nada daquela fila.
 * Deixar `lagging` de fora fazia a régua do Asaas pular a conexão e NÃO cobrar
 * ninguém por ela: no episódio de 16/09/2026, que durou a manhã toda, as
 * cobranças do dia teriam sido silenciosamente adiadas por uma latência de
 * entrada (Codex, PR #220).
 *
 * `pairing`, `stale` e `lastError` continuam FORA. Amarelo novo decide por
 * escrito de que lado fica.
 */
const ENVIA_MESMO_EM_AMARELO = new Set(['webhook', 'lagging']);

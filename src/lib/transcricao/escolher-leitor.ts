// ============================================================
// QUAL provedor lê (ou transcreve): o primeiro, na ordem pedida, cuja CHAVE a
// conta tem (`cb_ia_chaves`, 1047). Nada de agente, canal ou configuração de
// módulo: a leitura e a transcrição têm modelo fixo por provedor
// (`leitores.ts`) e só dependem de haver chave.
//
// ⚠️ As regras que seguram a escolha:
//  - Erro de LEITURA do banco PARA a escolha (`erro`, sem cair para o próximo
//    provedor): "não consegui ler a chave do Gemini" não é "não há chave do
//    Gemini" — cair para a OpenAI por um soluço mandaria o arquivo do cliente
//    a outro provedor que o operador pôs como reserva.
//  - A chave ILEGÍVEL (`ENCRYPTION_KEY` trocada) é pulada: o próximo provedor
//    lê. Sem nenhum que sirva, a resposta diz "ilegível", não "sem chave" —
//    é o que manda cadastrar de novo.
//  - A chave da OpenAI que nasceu SÓ da base (`soDaBase`, a marca da 1047) é
//    pulada: ela pode ser restrita aos embeddings, e cada leitura falharia.
// ============================================================

import type { AiProvider } from '@/lib/ai/types'
import { lerChave } from '@/lib/ia-chaves/repo'

export type EscolhaDoLeitor =
  | { ok: true; provedor: AiProvider; chave: string }
  | { ok: false; motivo: 'sem_chave' | 'ilegivel' | 'erro' }

export async function escolherLeitor(
  accountId: string,
  ordem: readonly AiProvider[],
): Promise<EscolhaDoLeitor> {
  let ilegivel = false
  for (const provedor of ordem) {
    let lida: Awaited<ReturnType<typeof lerChave>>
    try {
      lida = await lerChave(accountId, provedor)
    } catch {
      return { ok: false, motivo: 'erro' }
    }
    if (lida.ilegivel) {
      ilegivel = true
      continue
    }
    if (!lida.chave) continue
    if (provedor === 'openai' && lida.soDaBase === true) continue
    return { ok: true, provedor, chave: lida.chave }
  }
  return { ok: false, motivo: ilegivel ? 'ilegivel' : 'sem_chave' }
}

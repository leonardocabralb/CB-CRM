// ============================================================
// Quais mensagens DA CONVERSA ABERTA casam com o termo da busca.
//
// A Fase 5 respondeu "em QUAIS conversas o texto aparece" (RPC 929, no banco).
// Este arquivo responde a pergunta seguinte, dentro de uma conversa só: "em
// quais MENSAGENS", para o fio poder rolar até lá e destacar.
//
// ⚠️ POR QUE ISTO RODA EM JS, E POR QUE NÃO É "MEIO A MEIO"
// Porque o fio já carregou a conversa INTEIRA: a busca das mensagens é
// `.eq('conversation_id').order('created_at')`, sem `limit` (a maior conversa
// da conta tem 158 mensagens). Perguntar ao banco de novo devolveria ids de
// mensagens que já estão no DOM, e cobraria uma ida ao servidor a cada ↑/↓.
//
// Quais CONVERSAS casam continua vindo do banco, completo. O que roda aqui é
// só a enumeração dentro de uma conversa inteiramente carregada — as duas
// pontas enxergam o mesmo universo, que é a regra que a Fase 5 fixou.
//
// ⚠️ ISTO SÓ VALE ENQUANTO O FIO CARREGAR TUDO. No dia em que a busca de
// mensagens ganhar `limit` ou paginação, este arquivo passa a enxergar menos
// que o banco e o contador "2 de 5" começa a mentir — em silêncio, porque
// nada aqui tem como perceber que faltou mensagem. Quem paginar o fio precisa
// voltar aqui.
// ============================================================

import { semAcento, termoBuscavel } from "./busca-em-mensagens";

/**
 * O mínimo que uma mensagem precisa ter para entrar na conta.
 *
 * Deliberadamente mais estreito que `Message`: a regra não depende de canal,
 * autor nem status, e um tipo estreito deixa o teste montar uma linha em três
 * campos.
 */
export interface MensagemBuscavel {
  id: string;
  content_text?: string | null;
  deleted_at?: string | null;
}

/**
 * Os ids das mensagens que casam com o termo, na ordem em que aparecem no fio.
 *
 * ⚠️ AS TRÊS GUARDAS ABAIXO SÃO AS MESMAS DA RPC 929, e a igualdade é o ponto:
 * a lista diz "3 msgs" com o número que veio do banco, e o fio diz "1 de 3"
 * com o número contado aqui. Os dois aparecem na tela ao mesmo tempo. Qualquer
 * regra que divirja produz dois números diferentes para a mesma pergunta, lado
 * a lado, sem nada explicando qual está certo.
 *
 * 1. **piso de 3 caracteres** — `termoBuscavel`, o mesmo da caixa e o mesmo do
 *    `length(termo.normalizado) >= 3` da RPC;
 * 2. **mensagem apagada fica de fora** (`deleted_at IS NULL`). O fio RENDERIZA
 *    a apagada, como "mensagem apagada", então sem esta guarda o ↑/↓ pararia
 *    numa bolha onde o termo não aparece mais;
 * 3. **só `content_text`** — nunca `text_before_edit`. A RPC busca no texto
 *    vigente; achar pelo texto que foi corrigido levaria o operador a uma
 *    mensagem que não diz mais aquilo.
 *
 * O termo é aparado nas pontas como o `btrim(p_termo)` da RPC, e comparado sem
 * acento e em minúsculas — o `semAcento` daqui é a contraparte do
 * `cb_texto_para_busca` de lá.
 *
 * ⚠️ **AS DUAS NORMALIZAÇÕES SÃO PRÓXIMAS, NÃO IDÊNTICAS — e isto foi MEDIDO,
 * não suposto.** Varrendo todo caractere do corpo das mensagens desta conta,
 * três deles o `unaccent` do Postgres dobra e o `semAcento` daqui não:
 *
 *     …  (U+2026) → '...'      –  (U+2013) → '-'      ×  (U+00D7) → '*'
 *
 * Como o banco dobra MAIS, o conjunto do JS é subconjunto do dele: o fio pode
 * achar MENOS que a lista, nunca mais. Na prática é preciso que o trecho
 * casado contenha um desses caracteres — hoje 5 mensagens em 784 os têm.
 * Quando acontece, o pior caso é o contador do fio ficar abaixo do "N msgs" da
 * linha, ou a faixa sumir (o caso zero está tratado em `message-thread.tsx`).
 *
 * Deliberadamente NÃO replicamos a tabela do `unaccent` aqui: ela tem centenas
 * de entradas, e uma cópia parcial passaria a AFIRMAR uma equivalência que não
 * teria — que é pior que a diferença conhecida e escrita.
 *
 * ⚠️ `%` e `_` NÃO são coringas aqui, e também não são lá: a RPC os escapa
 * antes do `LIKE`. Um `includes` cru já os trata como literais, então as duas
 * pontas concordam sem código extra — mas só por sorte de forma, e é por isso
 * que está escrito.
 */
export function acharNoFio(
  mensagens: readonly MensagemBuscavel[],
  termo: string,
): string[] {
  if (!termoBuscavel(termo)) return [];

  const alvo = semAcento(termo.trim());
  const ids: string[] = [];

  for (const m of mensagens) {
    if (m.deleted_at) continue;
    if (!m.content_text) continue;
    if (semAcento(m.content_text).includes(alvo)) ids.push(m.id);
  }

  return ids;
}

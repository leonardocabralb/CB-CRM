// ============================================================
// Payload arbitrário → `{{vars.*}}` da automação. Puro.
//
// As restrições daqui NÃO são gosto: vêm do interpolador do motor
// (`interpolate`, engine.ts), e desrespeitá-las falha em SILÊNCIO — o
// `{{vars.x}}` fica literal, ou vira string vazia, no texto que sai para o
// cliente.
//
//   1. A chave é casada por `/\{\{\s*([\w.]+)\s*\}\}/`, e `\w` é
//      `[A-Za-z0-9_]`. Acento, hífen, espaço e ponto no meio do nome não
//      casam.
//   2. O motor lê UM nível (`partes[1]`), então `{{vars.pedido.total}}`
//      buscaria a variável `pedido` e ignoraria o resto. Por isso aninhado
//      vira `pedido_total`, com sublinhado.
//   3. O valor é `String(...)`: objeto viraria "[object Object]" e array
//      viraria "a,b". Achatar antes é o que dá controle sobre isso.
//
// E há duas chaves RESERVADAS dentro de `vars`: `_cadeia` (guarda
// anti-ciclo da 936) e `_tag_chain_depth` (teto de encadeamento de tag). Um
// payload de fora que as sobrescrevesse furaria as duas guardas. O
// saneamento derruba o sublinhado inicial, o que já as torna inalcançáveis
// — e há teste cobrando isso, porque é garantia estrutural, não sorte.
// ============================================================

/** Teto de variáveis por acionamento. Além disto é engano, não uso. */
export const MAX_VARIAVEIS = 100;

/** Teto por valor. O log não é lugar para um anexo em base64. */
export const MAX_TAMANHO_DO_VALOR = 500;

/** Até onde descer no aninhamento. */
export const PROFUNDIDADE_MAXIMA = 5;

/** Nomes que o motor usa para si dentro de `vars`. */
export const NOMES_RESERVADOS = ["_cadeia", "_tag_chain_depth"] as const;

/**
 * Sanitiza uma chave do payload para um nome que o motor consiga casar.
 * Devolve `""` quando não sobra nada utilizável.
 *
 * Preserva MAIÚSCULAS de propósito: o painel do gatilho mostra o nome já
 * saneado, e o operador copia dali — rebaixar tudo faria `firstName` virar
 * `firstname` e a cópia da tela deixaria de bater com o que ele lê no
 * Typebot.
 */
export function nomeDeVariavel(cru: string): string {
  return cru
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // tira o acento, mantém a letra
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, ""); // derruba o sublinhado das pontas
}

function textoDoValor(v: string | number | boolean): string {
  const s = String(v);
  return s.length > MAX_TAMANHO_DO_VALOR
    ? s.slice(0, MAX_TAMANHO_DO_VALOR)
    : s;
}

/**
 * Achata um payload JSON para o `Record<string, string>` que entra em
 * `AutomationContext.vars`.
 *
 * - Aninhado vira `pai_filho`; item de lista vira `lista_0`.
 * - `null` entra como string VAZIA em vez de sumir: no log, "veio e estava
 *   vazio" e "não veio" são diagnósticos diferentes, e é justamente essa
 *   distinção que o operador precisa ao caçar um `{{vars.email}}` em branco.
 * - Chave que sanitiza para o mesmo nome de outra: a PRIMEIRA vence, na
 *   ordem do objeto. Determinístico, e a alternativa (sufixar) inventaria um
 *   nome que ninguém sabe adivinhar na hora de escrever a automação.
 */
export function achatarPayload(payload: unknown): Record<string, string> {
  // ⚠️ `Object.create(null)` e não `{}`: com protótipo, `saida["constructor"]`
  // já é uma função, não é nullish, e o `??=` abaixo NÃO atribui — a chave
  // sumiria do payload achatado E da lista do log, que é justamente a tela
  // que existe para explicar variável vazia. Vale para `toString`,
  // `valueOf`, `hasOwnProperty` e companhia.
  const saida: Record<string, string> = Object.create(null);
  const reservados = new Set<string>(NOMES_RESERVADOS);

  const descer = (valor: unknown, prefixo: string, nivel: number): void => {
    if (Object.keys(saida).length >= MAX_VARIAVEIS) return;

    if (valor === null || valor === undefined) {
      if (prefixo) saida[prefixo] ??= "";
      return;
    }
    if (
      typeof valor === "string" ||
      typeof valor === "number" ||
      typeof valor === "boolean"
    ) {
      if (prefixo) saida[prefixo] ??= textoDoValor(valor);
      return;
    }
    if (typeof valor !== "object") return; // função, símbolo: não vêm de JSON

    if (nivel >= PROFUNDIDADE_MAXIMA) return;

    const entradas: [string, unknown][] = Array.isArray(valor)
      ? valor.map((v, i) => [String(i), v])
      : Object.entries(valor as Record<string, unknown>);

    for (const [chave, filho] of entradas) {
      const nome = nomeDeVariavel(chave);
      if (!nome) continue;
      const composto = prefixo ? `${prefixo}_${nome}` : nome;
      // Redundante com a poda do sublinhado inicial, e mantido de propósito:
      // se um dia o saneamento mudar, a guarda continua de pé.
      if (reservados.has(composto)) continue;
      descer(filho, composto, nivel + 1);
    }
  };

  descer(payload, "", 0);
  return saida;
}

/**
 * Lê do payload achatado o valor de um campo configurado no webhook
 * (telefone, nome, id). Tolerante a maiúsculas porque o operador digita
 * esse nome à mão na tela, e `Telefone` não pode deixar de achar
 * `telefone`.
 *
 * Sem campo configurado devolve `null` — nunca adivinha. Adivinhar aqui
 * seria pegar o telefone errado do payload e mandar a mensagem do lead para
 * outra pessoa.
 */
export function valorDoCampo(
  variaveis: Record<string, string>,
  campo: string | null | undefined
): string | null {
  if (!campo) return null;
  const alvo = nomeDeVariavel(campo);
  if (!alvo) return null;
  if (variaveis[alvo] !== undefined) return variaveis[alvo] || null;

  const baixo = alvo.toLowerCase();
  for (const [k, v] of Object.entries(variaveis)) {
    if (k.toLowerCase() === baixo) return v || null;
  }
  return null;
}

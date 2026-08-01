// ============================================================
// Menção de colega na anotação interna (migration 918/919).
//
// Funções PURAS, sem React e sem I/O — é o que dá para testar de verdade.
// O `vitest.config.ts` fixa `environment: "node"` e o projeto não tem jsdom
// nem testing-library, então a caixa amarela em si é verificada no navegador;
// o que decide certo ou errado (onde começa o token, o que casa com o termo,
// quem sobrou no texto na hora de salvar) mora aqui.
//
// ⚠️ A menção é por NOME, não por e-mail. O print de referência do outro CRM
// mostrava e-mail, mas `GET /api/account/members` só devolve e-mail para
// admin+ — agent e viewer recebem `email: null`. Menção por e-mail ficaria
// vazia justamente para o perfil que mais usa o inbox.
// ============================================================

export interface MembroMencionavel {
  user_id: string;
  /** O que aparece depois do `@`. Vem do `memberLabel`. */
  rotulo: string;
}

/**
 * Quantos espaços o termo de busca aceita antes de desistir.
 *
 * Nome de gente tem espaço ("Leonardo Cabral"), então parar no primeiro
 * espaço quebraria a busca por sobrenome. Mas aceitar espaço sem limite faz
 * o `@` de uma frase inteira continuar "procurando" até o fim do parágrafo —
 * e aí qualquer texto com um e-mail no meio abriria a lista. Dois é o que
 * cobre "Nome Sobrenome" sem virar isso.
 */
const MAX_ESPACOS_NO_TERMO = 2;

/** Sem acento e sem caixa, para "jose" achar "José". */
function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * O token `@…` sob o cursor, se houver.
 *
 * Devolve `null` quando o cursor não está numa menção sendo digitada — que é
 * o caso na esmagadora maioria das teclas. Regras:
 *
 * - o `@` tem de estar no começo do texto ou depois de um espaço/quebra de
 *   linha. Sem isso, o `@` de um e-mail digitado na anotação abriria a lista;
 * - a busca não atravessa quebra de linha;
 * - o termo aceita no máximo `MAX_ESPACOS_NO_TERMO` espaços.
 */
export function tokenSobOCursor(
  texto: string,
  cursor: number,
): { inicio: number; termo: string } | null {
  if (cursor < 0 || cursor > texto.length) return null;

  let espacos = 0;
  for (let i = cursor - 1; i >= 0; i--) {
    const c = texto[i];
    if (c === '\n') return null;
    if (c === ' ') {
      espacos++;
      if (espacos > MAX_ESPACOS_NO_TERMO) return null;
      continue;
    }
    if (c !== '@') continue;

    const anterior = i > 0 ? texto[i - 1] : ' ';
    if (anterior !== ' ' && anterior !== '\n') return null;
    return { inicio: i, termo: texto.slice(i + 1, cursor) };
  }
  return null;
}

/**
 * Membros que casam com o termo, do jeito que a lista deve aparecer.
 *
 * Termo vazio (o usuário acabou de digitar `@`) devolve todo mundo — é o
 * comportamento útil numa conta de 2 a 10 pessoas, que é o tamanho real
 * daqui. Quem casa pelo COMEÇO do rótulo vem primeiro: digitar "ca" tem de
 * pôr "Carlos" antes de "Marcos Cabral".
 */
export function filtrarMembros(
  membros: readonly MembroMencionavel[],
  termo: string,
  limite = 8,
): MembroMencionavel[] {
  const alvo = normalizar(termo.trim());
  if (!alvo) return membros.slice(0, limite);

  const comeca: MembroMencionavel[] = [];
  const contem: MembroMencionavel[] = [];
  for (const m of membros) {
    const r = normalizar(m.rotulo);
    if (r.startsWith(alvo)) comeca.push(m);
    else if (r.includes(alvo)) contem.push(m);
  }
  return [...comeca, ...contem].slice(0, limite);
}

/**
 * Troca o token pelo rótulo escolhido e diz onde o cursor deve ficar.
 *
 * O espaço no fim é de propósito: sem ele o token continua "aberto" logo
 * depois de escolher, a lista reabre sozinha e a próxima tecla parece
 * selecionar outra pessoa.
 */
export function aplicarMencao(
  texto: string,
  inicio: number,
  cursor: number,
  rotulo: string,
): { texto: string; cursor: number } {
  const inserido = `@${rotulo} `;
  return {
    texto: texto.slice(0, inicio) + inserido + texto.slice(cursor),
    cursor: inicio + inserido.length,
  };
}

/**
 * Quem continua mencionado no texto, na hora de salvar.
 *
 * ⚠️ Derivado do TEXTO, e não da lista de quem foi clicado. Escolher um
 * colega e depois apagar o nome é comum (troca de ideia no meio da frase); se
 * a lista de cliques fosse a verdade, a pessoa levaria notificação de uma
 * menção que não existe mais na anotação — e ao abrir não acharia o próprio
 * nome, sem ter como saber por quê.
 *
 * A comparação é literal (com acento e caixa) porque o texto foi inserido por
 * `aplicarMencao` a partir do próprio rótulo.
 */
export function mencionadosNoTexto(
  texto: string,
  membros: readonly MembroMencionavel[],
): string[] {
  const achados = new Set<string>();
  for (const m of membros) {
    if (m.rotulo && texto.includes(`@${m.rotulo}`)) achados.add(m.user_id);
  }
  return [...achados];
}

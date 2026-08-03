// ============================================================
// A busca no corpo das mensagens (F2 fatia B).
//
// Funções PURAS e as formas que a tela troca com a RPC 929. Nada aqui consulta
// o banco — quem consulta é `src/hooks/use-busca-em-mensagens.ts`.
//
// ⚠️ O QUE ESTA FEATURE MUDA, EM UMA FRASE: a caixa de busca deixou de olhar só
// a ÚLTIMA mensagem de cada conversa e passou a olhar o histórico inteiro.
// Antes, achar uma conversa pelo que foi dito nela só funcionava se aquilo
// tivesse sido a última coisa dita — ou seja, quase nunca.
// ============================================================

/**
 * Menos que isto não vai ao banco.
 *
 * ⚠️ O piso existe no BANCO também (migration 929), e este aqui é só para
 * poupar a ida. Dois motivos para ele: o índice de trigrama não indexa termo
 * com menos de 3 caracteres, e "an" casaria com quase toda mensagem da conta —
 * um resultado que não recorta nada tem o mesmo valor de nenhum resultado.
 *
 * ⚠️ CONSEQUÊNCIA VISÍVEL, e é por isso que a tela avisa: com 1 ou 2 letras a
 * caixa **continua** achando por nome, telefone e grupo. Só a parte do corpo
 * fica de fora. Sem o aviso, o operador digita "PF", não acha a mensagem que
 * sabe que existe, e conclui que a busca está quebrada.
 */
export const TERMO_MINIMO = 3;

/** O que a RPC devolve por conversa. */
export interface AchadoNoTexto {
  /**
   * O pedaço da mensagem que casou — já recortado ao redor do termo pelo banco,
   * não o começo do texto.
   */
  trecho: string;
  /** Quantas mensagens daquela conversa casaram. */
  quantas: number;
}

/** `conversation_id` → o que casou lá dentro. */
export type AchadosNoTexto = Map<string, AchadoNoTexto>;

/**
 * O vazio compartilhado.
 *
 * Uma constante em vez de `new Map()` a cada render: a identidade estável evita
 * que todo `useMemo` que depende dela recalcule à toa.
 */
export const SEM_ACHADOS: AchadosNoTexto = new Map();

/** Vale a pena perguntar ao banco? */
export function termoBuscavel(busca: string): boolean {
  return busca.trim().length >= TERMO_MINIMO;
}

/**
 * Minúsculas e sem acento — a mesma forma canônica que a `cb_texto_para_busca`
 * da 929 aplica no banco.
 *
 * ⚠️ Existe para as DUAS metades da caixa concordarem. A busca no corpo ignora
 * acento (é `unaccent` no Postgres); a busca por nome fazia `includes` cru.
 * Sem isto, digitar "acao" acharia a MENSAGEM que fala em "ação" e não acharia
 * o CONTATO chamado "Ação" — duas regras diferentes no mesmo campo de texto,
 * sem nada na tela explicando qual está valendo em cada linha.
 *
 * `NFD` separa a letra do acento e a faixa `\p{Diacritic}` remove só o acento.
 */
export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/** Linha crua da RPC, antes de virar {@link AchadosNoTexto}. */
export interface LinhaDaBusca {
  conversation_id: string;
  trecho: string | null;
  /** `bigint` no Postgres — o PostgREST manda como número ou como string. */
  quantas: number | string | null;
}

/**
 * Traduz o que a RPC devolveu no mapa que a lista consome.
 *
 * ⚠️ `quantas` vem de um `count(*)`, que é `bigint`, e o PostgREST serializa
 * `bigint` como STRING quando o valor não cabe com segurança em número — ou
 * conforme a versão. `Number()` nos dois casos evita um "2 mensagens" virar
 * `"2"` e quebrar a comparação `> 1` que decide se o contador aparece.
 */
export function montarAchados(linhas: LinhaDaBusca[] | null): AchadosNoTexto {
  const mapa: AchadosNoTexto = new Map();
  for (const linha of linhas ?? []) {
    if (!linha?.conversation_id) continue;
    mapa.set(linha.conversation_id, {
      trecho: linha.trecho ?? "",
      quantas: Number(linha.quantas ?? 0) || 0,
    });
  }
  return mapa;
}

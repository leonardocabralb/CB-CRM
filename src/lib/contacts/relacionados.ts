// ============================================================
// Contatos relacionados (1069): a regra pura do vínculo entre duas fichas.
//
// UM vínculo é UMA linha (`contact_a_id`, `contact_b_id`) e vale para os dois
// lados: a tela procura o contato nas duas colunas e mostra a OUTRA ponta.
// O banco recusa o par repetido em qualquer ordem e a ficha ligada a si
// mesma; aqui só se traduz a recusa para a tela.
// ============================================================

/**
 * Teto da descrição ("esposa", "procurador"). Espelho do CHECK
 * `cb_contatos_relacionados_descricao` da 1069 — há teste lendo o SQL.
 */
export const TETO_DA_DESCRICAO = 80;

/** A linha como o banco a devolve. */
export interface VinculoGravado {
  id: string;
  contact_a_id: string;
  contact_b_id: string;
  descricao: string | null;
}

/** Só o que a linha da aba desenha (a mesma forma do seletor remoto). */
export interface ContatoDoVinculo {
  id: string;
  name: string | null;
  /** NULO na ficha só do Instagram (989) ou só-BSUID (1041). */
  phone: string | null;
  wa_username?: string | null;
  instagram_username?: string | null;
}

/** Um contato relacionado, pronto para a aba. */
export interface Relacionado {
  vinculoId: string;
  contatoId: string;
  /**
   * NULO quando a ficha não veio na leitura. Não deveria acontecer (a FK
   * apaga o vínculo junto com a ficha), e a aba mostra um travessão em vez
   * de sumir com a linha — sumir esconderia um vínculo que existe.
   */
  contato: ContatoDoVinculo | null;
  descricao: string | null;
  /** A conversa do contato (uma por contato, 036). NULO = ainda não conversou. */
  conversaId: string | null;
}

/** A outra ponta do vínculo, vista a partir de `contatoId`. */
export function outroLado(v: VinculoGravado, contatoId: string): string {
  return v.contact_a_id === contatoId ? v.contact_b_id : v.contact_a_id;
}

/**
 * O texto digitado como o banco o aceita: aparado, e vazio vira NULO (o
 * CHECK recusa `''` e espaço nas pontas). O teto é do `maxLength` do campo;
 * o CHECK é a última palavra.
 */
export function descricaoParaGravar(texto: string): string | null {
  const aparado = texto.trim();
  return aparado === '' ? null : aparado;
}

/**
 * Junta as três leituras (vínculos, fichas, conversas) na lista da aba, na
 * ordem em que os vínculos vieram (a de criação).
 */
export function montarRelacionados(
  contatoId: string,
  vinculos: VinculoGravado[],
  contatos: ContatoDoVinculo[],
  conversas: { id: string; contact_id: string | null }[],
): Relacionado[] {
  const fichaPorId = new Map(contatos.map((c) => [c.id, c]));
  const conversaPorContato = new Map<string, string>();
  for (const c of conversas) {
    if (c.contact_id) conversaPorContato.set(c.contact_id, c.id);
  }
  return vinculos.map((v) => {
    const outro = outroLado(v, contatoId);
    return {
      vinculoId: v.id,
      contatoId: outro,
      contato: fichaPorId.get(outro) ?? null,
      descricao: v.descricao,
      conversaId: conversaPorContato.get(outro) ?? null,
    };
  });
}

/**
 * O desfecho de uma escrita, do jeito que a tela precisa dizer.
 * - `ja-vinculados`: o par já existe (23505, em qualquer ordem).
 * - `invalido`: a ficha consigo mesma ou descrição fora da forma (23514).
 * - `recusado`: a RLS barrou (quem só visualiza).
 * - `sumiu`: o vínculo ou a ficha não existe mais (outro desfez, apagaram).
 */
export type DesfechoDaEscrita =
  | 'ok'
  | 'ja-vinculados'
  | 'invalido'
  | 'recusado'
  | 'sumiu'
  | 'falhou';

/** Traduz o erro do PostgREST. Código desconhecido é falha, nunca sucesso. */
export function desfechoDoErro(erro: { code?: string | null }): DesfechoDaEscrita {
  switch (erro.code) {
    case '23505':
      return 'ja-vinculados';
    case '23514':
      return 'invalido';
    case '42501':
      return 'recusado';
    // A ficha escolhida foi apagada entre a busca e o clique (FK composta).
    case '23503':
      return 'sumiu';
    default:
      return 'falhou';
  }
}

// ============================================================
// Texto de fora (digitado na tela, vindo da API) casado LITERALMENTE por
// um filtro do PostgREST.
//
// ⚠️⚠️ `like`/`ilike` não servem para "contém" um texto de fora, nem com o
// escape do LIKE: o PostgREST troca TODO `*` de um padrão like/ilike por
// `%` (o atalho de URL da documentação dele), sem forma de escapar, e
// "contém *" alcança todo mundo. O `imatch` (`~*`) ignora a caixa como o
// `ilike`, e o PostgREST não reescreve nada nele — basta escapar o texto
// como expressão regular (`literalParaRegex`).
//
// Dentro de um `.or()`, o valor viaja numa árvore em que vírgula, ponto,
// dois-pontos e parênteses são DELIMITADORES. Sem aspas, "silva, jr" vira
// filtro malformado (400 PGRST100, "failed to parse logic tree") e a tela
// diz "falha ao carregar"; com aspas, `"` e `\` levam barra, que o
// PostgREST desfaz antes de entregar o valor ao operador. São duas camadas,
// nesta ordem: a da regex e a das aspas — a segunda dobra as barras que a
// primeira pôs.
//
// ⚠️ MEDIDO contra o PostgREST real em 25/09/2026 (tela de Contatos, sessão
// do operador, só leitura), comparando com a contagem literal do banco: os
// 12 termos bateram, com e sem etiqueta — "silva, jr", "ria, co", "(83)" e
// "(escri" sem erro (antes 400), "%" 0 e "_" 43 (antes 5.227), "*" 2 (antes
// 5.227), "l*k*a" 1 (antes 37), `a"b` e `x\y` sem erro.
// ============================================================

/**
 * O valor digitado como TEXTO LITERAL numa expressão regular do Postgres:
 * cada metacaractere ganha uma barra.
 *
 * ⚠️⚠️ "Contém" do disparo já foi `ilike('%valor%')` sem escape (revisão do
 * PR #231, P1): `%` e `_` digitados viravam curingas, e "contém %" casava
 * todo contato com o campo preenchido — contagem e envio concordando sobre
 * o público ERRADO de uma campanha paga. Medido no Postgres da produção em
 * 25/09/2026: `'Bancário' ~* 'BANCÁRIO'`, `'a*b' ~* 'a\*b'` e
 * `'axb' ~* 'a\*b'` falso.
 */
export function literalParaRegex(valor: string): string {
  return valor.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}

/** O valor entre as aspas do PostgREST, para viajar inteiro num `.or()`. */
export function entreAspasDoPostgrest(valor: string): string {
  return `"${valor.replace(/(["\\])/g, '\\$1')}"`;
}

/**
 * Um ramo "a coluna CONTÉM o termo, literalmente e sem olhar a caixa" para
 * o `.or()` do PostgREST.
 */
export function ramoContem(coluna: string, termo: string): string {
  return `${coluna}.imatch.${entreAspasDoPostgrest(literalParaRegex(termo))}`;
}

/**
 * O termo pronto para um `ILIKE '%' || termo || '%'` escrito no BANCO (o
 * parâmetro de uma RPC): `\`, `%` e `_` levam a barra, que é o escape
 * padrão do LIKE no Postgres. Ali o `*` já é literal — o que o reescreve é
 * o PostgREST, e parâmetro de RPC não passa por ele.
 */
export function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, (c) => `\\${c}`);
}

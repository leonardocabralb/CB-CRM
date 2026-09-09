// ============================================================
// A chave pela qual dois nomes de etiqueta são "a mesma".
//
// ⚠️ Este arquivo tem um GÊMEO EM SQL: a coluna gerada `tags.name_key`
// (migration 984, que substituiu a régua da 983) e o índice único
// `(account_id, name_key)` por cima dela. Os dois precisam concordar, e a
// migration documenta a correspondência. Mudar um lado sem o outro faz o
// código decidir "é nova" e o banco responder 23505 — ou o contrário, o
// código criar em silêncio uma etiqueta que o operador já tinha.
//
// Por que sem acento: quem digita nome de etiqueta num fluxo de fora
// (Typebot, n8n) ou numa planilha de import quase sempre escreve sem
// acento, e num CRM em português isso é a regra, não a exceção. Medido na
// API em 08/09/2026: `"bancario"` num contato que já tinha **"Bancário"**
// criava uma SEGUNDA etiqueta no catálogo do escritório, sem erro nem
// aviso. Decisão do operador em 09/09/2026: uma régua só, nas três portas
// (API aditiva, `PATCH` substitutivo e import de CSV) e no banco.
// ============================================================

/**
 * Normaliza um nome de etiqueta para comparação: aparado, sem acento,
 * em minúsculas.
 *
 * ⚠️ `\p{Mn}` e não `\p{Diacritic}`: a segunda faixa inclui o acento que
 * existe SOZINHO (`^`, `` ` ``, `´`, `¨`, `~`), e apagá-los transformaria
 * nomes distintos em iguais.
 *
 * ⚠️⚠️ **O `.normalize('NFD')` vem ANTES de apagar os sinais, e não é
 * enfeite.** "Bancário" tem duas formas Unicode canonicamente equivalentes:
 * a precomposta (`á` = U+00E1) e a DECOMPOSTA (`a` + U+0301), que é a que
 * sai de exportação feita no macOS e de vários geradores de CSV. Sem o
 * NFD, as duas dariam chaves diferentes.
 *
 * ⚠️ A 983 tratava só a forma precomposta (um `translate` de acentos), e o
 * índice único deixava a decomposta entrar — o backstop tinha um furo
 * exatamente no caso em que o código sozinho também podia errar, porque
 * com as duas inserções concorrentes cada requisição podia reler antes do
 * commit da outra e disparar `tag_added` duas vezes. A 984 passou o SQL a
 * fazer o mesmo que aqui: `normalize(..., NFD)` e apagar o bloco
 * U+0300–U+036F. (Achado do Codex no PR #151.)
 *
 * ⚠️ Esta versão ainda colapsa um pouco mais que a de SQL — `\p{Mn}`
 * alcança sinal combinante fora daquele bloco (escritas não latinas). A
 * folga cai para o lado seguro: o código considera "a mesma" e não tenta
 * criar, então o banco nunca recusa criação legítima. O contrário (SQL
 * colapsando mais que o código) faria uma etiqueta sumir em silêncio.
 */
export function chaveDeTag(nome: string): string {
  return nome
    .trim()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();
}

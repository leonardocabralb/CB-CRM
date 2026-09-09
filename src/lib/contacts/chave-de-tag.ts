// ============================================================
// A chave pela qual dois nomes de etiqueta são "a mesma".
//
// ⚠️ Este arquivo tem um GÊMEO EM SQL: a coluna gerada `tags.name_key`
// (migration 983) e o índice único `(account_id, name_key)` por cima dela.
// Os dois precisam concordar, e a migration documenta a correspondência
// linha a linha. Mudar um lado sem o outro faz o código decidir "é nova" e
// o banco responder 23505 — ou o contrário, o código criar em silêncio uma
// etiqueta que o operador já tinha.
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
 * ⚠️ Esta versão colapsa MAIS que a de SQL, e é assim de propósito: o
 * `\p{Mn}` alcança todo sinal combinante, enquanto o `translate` da 983
 * cobre a lista latina que o português usa. A folga cai para o lado
 * seguro — o código considera "a mesma" e não tenta criar, então o banco
 * nunca recusa uma criação legítima. O contrário (SQL colapsando mais que
 * o código) faria uma etiqueta sumir em silêncio.
 */
export function chaveDeTag(nome: string): string {
  return nome
    .trim()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase();
}

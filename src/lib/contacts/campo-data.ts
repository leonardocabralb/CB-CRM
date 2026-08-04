// ------------------------------------------------------------
// Campo personalizado do tipo DATA (migration 935).
//
// ⚠️ O fuso é o ponto inteiro deste módulo. O contêiner roda em UTC, quem
// digita está em Brasília, e `contact_custom_values.value` é TEXT livre.
// Gravar "2026-08-05 14:00" cru faz o Postgres ler como UTC, e todo lembrete
// erra por 3 horas — sem erro nenhum, só chegando na hora errada.
//
// A convenção, num lugar só: no BANCO fica ISO 8601 em UTC (`...Z`), que é
// absoluto; na TELA aparece a hora local de quem está olhando. As duas
// conversões vivem aqui e são testadas.
// ------------------------------------------------------------

/** O que o app grava em `custom_fields.field_type` para um campo de data. */
export const TIPO_DATA = 'datetime'

/**
 * ISO do banco → o valor que `<input type="datetime-local">` entende
 * (`YYYY-MM-DDTHH:mm`, sempre em hora LOCAL do navegador).
 *
 * Tolerante de propósito: o campo é TEXT livre e pode ter qualquer coisa
 * escrita antes de virar data. Lixo devolve string vazia — o input nasce em
 * branco em vez de quebrar a ficha do contato.
 */
export function paraEntradaLocal(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  // `toISOString()` daria UTC; aqui a subtração do offset faz o texto sair na
  // hora local, que é o que o input exige.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/**
 * O valor do `<input type="datetime-local">` → ISO absoluto para o banco.
 *
 * O navegador entrega hora local sem fuso ("2026-08-05T14:00"); `new Date()`
 * a interpreta no fuso do navegador, e `toISOString()` a fixa em UTC. É
 * justamente essa passagem que impede o erro de 3 horas.
 */
export function deEntradaLocal(local: string | null | undefined): string {
  if (!local) return ''
  const d = new Date(local)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

/** Rótulo legível de um valor guardado, para exibição fora do formulário. */
export function formatarData(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  // `undefined` como locale = o do navegador. Fixar 'en-US' faria a data sair
  // em inglês com o app em português — armadilha já documentada no projeto.
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

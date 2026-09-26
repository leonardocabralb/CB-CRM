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

/**
 * Data + hora + fuso ESCRITO. Os grupos separam as partes para
 * `instanteCanonico` remontar a forma estrita antes do parse.
 */
const INSTANTE_COM_OFFSET =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}(?::?\d{2})?)$/i

/**
 * O MESMO instante escrito sempre do MESMO jeito: `toISOString()` (UTC, 3
 * casas). "2026-09-28T17:30:00.000000Z" (a automação do Calendly),
 * "…17:30:00.000Z" (a API v1), "… 17:30:00+00" (o PostgREST) e
 * "…14:30:00-03:00" viram o mesmo texto.
 *
 * Existe porque texto é chave: a trava do lembrete (935) é por VALOR, e dois
 * escritores gravando o mesmo horário em formatos diferentes mandavam o
 * lembrete duas vezes.
 *
 * ⚠️ Só aceita valor com fuso ESCRITO (`Z` ou `±HH[:MM]`). Sem fuso, o JS lê
 * na hora local do processo e o Postgres na do banco: "canonizar" ali seria
 * escolher um dos dois em silêncio. Devolve `null` e quem chama decide.
 *
 * ⚠️ A forma é remontada ANTES do parse (espaço → `T`, `+00` → `+00:00`,
 * fração em 3 casas): o `Date.parse` do V8 recusa `T…+00` e `-03` sem
 * minutos, e só aceita o espaço pelo parser legado. A fração é CORTADA, como
 * o V8 já faz com microssegundos.
 */
export function instanteCanonico(texto: string | null | undefined): string | null {
  if (typeof texto !== 'string') return null
  const m = INSTANTE_COM_OFFSET.exec(texto.trim())
  if (!m) return null
  const [, data, horaMinuto, segundos, fracao, fusoBruto] = m
  // ⚠️ Dia que não existe no mês ("2026-02-29", "2026-09-31") é RECUSADO: o
  // `Date.parse` do V8 o empurra para o mês seguinte, e o Postgres o recusa.
  // Canonizado, o passo `update_contact_field` gravaria na ficha uma data que
  // ninguém mandou — e o lembrete sairia nela (revisão do PR #305).
  const [ano, mes, dia] = data.split('-').map(Number)
  if (new Date(Date.UTC(ano, mes - 1, dia)).getUTCDate() !== dia) return null
  const fuso = /^z$/i.test(fusoBruto)
    ? 'Z'
    : `${fusoBruto.slice(0, 3)}:${fusoBruto.slice(3).replace(':', '') || '00'}`
  const ms = (fracao ?? '').padEnd(3, '0').slice(0, 3)
  const estrito = `${data}T${horaMinuto}:${segundos ?? '00'}.${ms}${fuso}`
  const instante = Date.parse(estrito)
  return Number.isFinite(instante) ? new Date(instante).toISOString() : null
}

/**
 * O fuso do escritório. O Brasil não tem horário de verão desde 2019; se
 * voltar, muda aqui.
 */
export const FUSO_DO_ESCRITORIO = 'America/Sao_Paulo'

/**
 * "2026-08-30T19:00:00Z" → "30/08/2026 às 16:00h" no fuso do escritório.
 *
 * É a forma que vai para MENSAGEM — o lembrete de reunião que o cliente
 * recebe e o aviso de agendamento que a equipe recebe. Formato escolhido pelo
 * operador em 2026-09-08.
 *
 * ⚠️ Montada por `formatToParts`, nunca por `toLocaleString`: a forma varia
 * entre majors do Node (o PR #66 reprovou no CI por `Intl` divergindo entre
 * 22 e 24), e aqui ela viaja para o WhatsApp do cliente.
 *
 * ⚠️ E o FUSO é fixo no do escritório, não o do servidor: o contêiner roda em
 * UTC, então sem ele toda reunião da tarde sairia três horas adiantada na
 * mensagem — sem erro nenhum, só chegando errada. `formatarData` (acima) é o
 * oposto de propósito: ela é para a TELA, onde o certo é a hora de quem olha.
 */
export function formatarParaMensagem(
  iso: string | null | undefined,
  fuso: string = FUSO_DO_ESCRITORIO,
): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const partes = new Intl.DateTimeFormat('pt-BR', {
    timeZone: fuso,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d)
  const p = (tipo: Intl.DateTimeFormatPartTypes) =>
    partes.find((x) => x.type === tipo)?.value ?? ''
  return `${p('day')}/${p('month')}/${p('year')} às ${p('hour')}:${p('minute')}h`
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

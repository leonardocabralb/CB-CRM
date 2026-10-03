// ============================================================
// O texto que o MOTOR grava em cada passo, em português — puro, testável.
//
// `automation_logs.steps_executed[].detail` é escrito pelo motor em inglês
// técnico ("branch=no", "webhook returned 404", "tag … already present"), e o
// "Já rodou" da conversa é lido por quem atende, não por quem programou
// (decisão do operador, 29/09/2026: traduzir os comuns).
//
// ⚠️ A tradução é NA TELA, nunca no motor — o mesmo racional de
// `registro-legivel.ts`: vale para os registros já gravados, e o texto
// guardado continua sendo a fotografia do que rodou. Quem mostra deixa o
// texto original no `title`.
//
// ⚠️ Texto desconhecido NUNCA some: volta como está (`{ texto }`). A tabela
// cobre os frequentes (medidos em produção em 29/09/2026), não todos — um
// erro do provedor ou um texto novo do motor aparece cru, que é o que
// aparecia antes.
//
// Os ids já chegam trocados pelo nome (`textoComNomes`) quando a tela chama
// isto — por isso os padrões aceitam qualquer coisa (`.+`) onde havia um id.
// ============================================================

/** Um pedaço do texto: frase do dicionário (`Inbox.execucoes.motor.*`) ou texto cru. */
export type ParteDoTexto =
  | { chave: string; valores: Record<string, string | number> }
  | { texto: string }

interface Padrao {
  re: RegExp
  /**
   * A frase, ou `null` quando o texto só CONFIRMA o que o ✓ e o nome do passo
   * já dizem ("sent (…)", "custom field updated") — repetir vira ruído numa
   * lista de 13 passos.
   */
  ler: (m: RegExpMatchArray) => ParteDoTexto | null
}

const frase = (chave: string, valores: Record<string, string | number> = {}): ParteDoTexto => ({
  chave,
  valores,
})

/** O que o destino de um webhook quis dizer com o status. */
function webhookQueFalhou(status: number): ParteDoTexto {
  if (status === 404) return frase('webhookNaoEncontrado', { status })
  if (status === 401 || status === 403) return frase('webhookRecusou', { status })
  if (status >= 500) return frase('webhookErroNoDestino', { status })
  return frase('webhookStatus', { status })
}

// A ordem importa: o primeiro que casa vence ("tag X added; … skipped" antes
// de "X updated", que casaria qualquer coisa terminada em "updated").
const PADROES: Padrao[] = [
  { re: /^sent \(.*\)$/, ler: () => null },
  { re: /^interactive sent \(.*\)$/, ler: () => null },
  { re: /^template sent \(.*\)$/, ler: () => null },
  { re: /^\w+ enviado \(.*\)$/, ler: () => null },
  { re: /^sent to (\d+) \(.*\)$/, ler: (m) => frase('enviadaPara', { numero: m[1] }) },
  { re: /^waiting \d+ \w+( \(para se o cliente responder\))?$/, ler: () => null },
  { re: /^tag .+ already present$/, ler: () => frase('etiquetaJaEstava') },
  { re: /^tag .+ added( and tag_added dispatched|; tag_added dispatch skipped at depth \d+)$/, ler: () => null },
  { re: /^tag .+ removed$/, ler: () => null },
  { re: /^no agent resolved$/, ler: () => frase('semResponsavel') },
  {
    re: /^agent (.+) is suspended — conversation left unassigned$/,
    ler: (m) => frase('responsavelSuspenso', { nome: m[1] }),
  },
  { re: /^.+ not updated: empty value$/, ler: () => frase('campoVazio') },
  { re: /^field .+ not writable from automations$/, ler: () => frase('campoNaoGravavel') },
  { re: /^name not updated: the value is not a name$/, ler: () => frase('nomeRecusado') },
  { re: /^[\w ]+ updated$/, ler: () => null },
  { re: /^deal created$/, ler: () => null },
  { re: /^deal already existed$/, ler: () => frase('cardJaExistia') },
  // O motor grava o id da etapa que USOU; a tela o troca pelo nome. É a
  // fotografia — o nome do passo vem da automação de HOJE, que pode ter mudado.
  { re: /^negócio movido para (.+)$/, ler: (m) => frase('cardMovido', { etapa: m[1] }) },
  { re: /^negócio marcado (won|lost|open)$/, ler: () => null },
  {
    re: /^branch=(yes|no)$/,
    ler: (m) => frase(m[1] === 'yes' ? 'ramoSim' : 'ramoNao'),
  },
  { re: /^webhook (\d{3})$/, ler: (m) => frase('webhookOk', { status: Number(m[1]) }) },
  { re: /^webhook returned (\d{3})$/, ler: (m) => webhookQueFalhou(Number(m[1])) },
  { re: /^send_webhook: destination not allowed$/, ler: () => frase('webhookBloqueado') },
  { re: /^conversation closed$/, ler: () => null },
  { re: /^tarefa criada \((.+)\)$/, ler: (m) => frase('tarefaCriada', { tarefa: m[1] }) },
  { re: /^(?:Error: )?Connection Closed$/i, ler: () => frase('conexaoCaiu') },
  // A frase é do `throwError` de `evolution-client.ts` (400 com `exists: false`).
  { re: /^number (\S+) is not on WhatsApp$/, ler: (m) => frase('semWhatsApp', { numero: m[1] }) },
]

/** A nota entre parênteses da condição ("hora no escritório: dom 18:57") já é português. */
const RE_RAMO_COM_NOTA = /^branch=(yes|no) \((.+)\)$/

/** Os três sufixos da retentativa (`engine.ts`, `catch` de `executeStepsFrom`). */
const RE_TENTATIVA = /^([\s\S]+) — tentativa (\d+) de (\d+); nova tentativa em (\d+)s$/
const RE_DESISTIU = /^([\s\S]+) — desisti depois de (\d+) tentativas$/
const RE_NAO_REPETIU = /^([\s\S]+) — não reenfileirada: a execução já foi interrompida$/

/** O aviso de que o passo vai ser tentado de novo (não é a falha que parou a execução). */
export function ehAvisoDeTentativa(texto: string | null | undefined): boolean {
  return typeof texto === 'string' && RE_TENTATIVA.test(texto)
}

function lerBase(texto: string): ParteDoTexto[] {
  const t = texto.trim()
  const ramo = t.match(RE_RAMO_COM_NOTA)
  if (ramo) return [frase(ramo[1] === 'yes' ? 'ramoSim' : 'ramoNao'), { texto: ramo[2] }]
  for (const p of PADROES) {
    const m = t.match(p.re)
    if (m) {
      const parte = p.ler(m)
      return parte ? [parte] : []
    }
  }
  return t ? [{ texto: t }] : []
}

/**
 * O texto do motor em pedaços para a tela: frases do dicionário onde há
 * tradução, o texto cru onde não há. Vazio = nada a acrescentar ao nome do
 * passo (o texto só confirmava o que o ✓ já diz).
 */
export function lerTextoDoMotor(texto: string | null | undefined): ParteDoTexto[] {
  if (typeof texto !== 'string' || texto.trim() === '') return []
  const tentativa = texto.match(RE_TENTATIVA)
  if (tentativa) {
    return [
      ...lerBase(tentativa[1]),
      frase('tentativa', {
        n: Number(tentativa[2]),
        de: Number(tentativa[3]),
        segundos: Number(tentativa[4]),
      }),
    ]
  }
  const desistiu = texto.match(RE_DESISTIU)
  if (desistiu) return [...lerBase(desistiu[1]), frase('desistiu', { n: Number(desistiu[2]) })]
  const naoRepetiu = texto.match(RE_NAO_REPETIU)
  if (naoRepetiu) return [...lerBase(naoRepetiu[1]), frase('naoRepetiu')]
  return lerBase(texto)
}

/** Todas as chaves que `lerTextoDoMotor` pode devolver — o teste cobra os dois dicionários. */
export const CHAVES_DO_MOTOR = [
  'enviadaPara',
  'etiquetaJaEstava',
  'semResponsavel',
  'responsavelSuspenso',
  'campoVazio',
  'campoNaoGravavel',
  'nomeRecusado',
  'cardJaExistia',
  'cardMovido',
  'ramoSim',
  'ramoNao',
  'webhookOk',
  'webhookNaoEncontrado',
  'webhookRecusou',
  'webhookErroNoDestino',
  'webhookStatus',
  'webhookBloqueado',
  'tarefaCriada',
  'conexaoCaiu',
  'semWhatsApp',
  'tentativa',
  'desistiu',
  'naoRepetiu',
] as const

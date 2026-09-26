// ============================================================
// Os valores do passo "Enviar modelo" (`send_template`) das automações —
// Fase 2.3 do `docs/PLANO-previdenciario.md`.
//
// Até aqui o passo escolhia só o modelo e o idioma: `{{1}}` não tinha campo na
// tela, os valores (quando vinham pela API) saíam LITERAIS, e o envio ia pelo
// caminho "só corpo", sem a linha do modelo — então modelo com cabeçalho de
// imagem/vídeo/documento ou botão com URL variável era recusado pela Meta.
// Na prática, a automação só mandava modelo estático.
//
// O que existe agora:
//   - cada `{{N}}` do CORPO tem um valor (`variables[N]`) que passa pela
//     interpolação do motor (`{{contact.name}}`, `{{deal.value}}`,
//     `{{contact.campo.x}}`…) e um TEXTO DE RESERVA (`variaveis_reserva[N]`),
//     usado quando o valor sai vazio — a Meta recusa parâmetro vazio, e um
//     contato sem nome derrubaria o envio;
//   - o `{{1}}` de um cabeçalho de TEXTO (`header_text` + reserva);
//   - o arquivo do cabeçalho de mídia (`header_media_url`), opcional: vazio,
//     vale o arquivo guardado no modelo (o envio passa a levar a linha do
//     modelo, e `buildSendComponents` o acrescenta sozinho);
//   - o final do endereço de um botão de URL com `{{1}}` (`button_params`,
//     pela posição do botão no modelo).
//
// ⚠️ O CORPO é POSICIONAL: `body[N-1]` é o `{{N}}`. A versão anterior
// ordenava as chaves e as compactava, e `{"1": "a", "3": "c"}` mandava o "c"
// como `{{2}}`. Chave que não é posição (1, 2, …) é ignorada — a tela nunca
// grava outra coisa, e `validate.ts` a recusa na ativação.
//
// ⚠️ Quem confere se FALTOU valor é `faltaNoModelo`, no remetente
// (`meta-send.ts`), porque só lá a linha do modelo é conhecida (ela depende do
// canal de saída: o catálogo da Meta é POR WABA). Aqui não se sabe quantas
// variáveis o modelo tem; um valor vazio sai vazio e é barrado lá.
// ============================================================

import type { MessageTemplate, SendTemplateStepConfig } from '@/types'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'

/**
 * A interpolação do motor; `cru` = o modo de DADO (sem "R$", data em ISO);
 * `url` = cada valor SUBSTITUÍDO sai codificado para caber num endereço (o
 * texto literal do operador fica como ele escreveu).
 */
export type Interpolar = (
  texto: string,
  opcoes: { cru: boolean; url?: boolean }
) => Promise<string>

/**
 * Teto de posições (`{{1}}` a `{{50}}`). O laço do motor vai até a maior
 * posição gravada, com uma interpolação por posição: sem teto, um
 * `{"999999": "x"}` gravado pela API rodaria um milhão delas. Nenhum modelo
 * de verdade chega perto; `validate.ts` recusa acima disso na ativação.
 */
export const MAX_POSICOES_DO_MODELO = 50

/** Os valores prontos para `sendTemplateMessage`, com o corpo sempre presente. */
export type ParametrosDoModelo = SendTimeParams & { body: string[] }

/**
 * A Meta recusa parâmetro de modelo com quebra de linha, tabulação ou mais de
 * quatro espaços seguidos (erro 132018). `{{message.text}}` e um campo
 * preenchido pelo Typebot trazem as duas coisas; achatar aqui é o que evita o
 * passo falhar por causa da forma do texto.
 */
export function textoDeParametro(valor: string): string {
  return valor.replace(/\s+/g, ' ').trim()
}

/**
 * Posições (1, 2, …) de um mapa gravado, ignorando chave que não é posição —
 * e a que passa do teto (`MAX_POSICOES_DO_MODELO`).
 */
function posicoes(mapa: Record<string, unknown> | undefined): number[] {
  if (!mapa || typeof mapa !== 'object') return []
  return Object.keys(mapa)
    .filter((k) => /^[1-9]\d*$/.test(k))
    .map(Number)
    .filter((n) => n <= MAX_POSICOES_DO_MODELO)
}

/**
 * O valor gravado como texto. Número e booleano viram texto, como no código
 * antigo (`String(v)`): uma config `{ "1": 123 }` gravada pela API antes da
 * validação nova não pode passar a falhar como "variável vazia".
 */
function texto(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * Monta os valores do envio a partir da config do passo. Cada valor passa por
 * `interpolar`; vazio depois disso, vale a reserva (literal, sem variáveis —
 * é ela que garante que algo saia). Vazio nos dois, sai vazio: quem barra é
 * `faltaNoModelo`, que sabe se aquela posição existe no modelo.
 */
export async function montarParametrosDoModelo(
  cfg: SendTemplateStepConfig,
  interpolar: Interpolar
): Promise<ParametrosDoModelo> {
  const valores = cfg.variables ?? {}
  const reservas = cfg.variaveis_reserva ?? {}
  const maior = Math.max(0, ...posicoes(valores), ...posicoes(reservas))

  const body: string[] = []
  for (let n = 1; n <= maior; n++) {
    const bruto = texto((valores as Record<string, unknown>)[String(n)])
    const valor = textoDeParametro(await interpolar(bruto, { cru: false }))
    body.push(valor || textoDeParametro(texto((reservas as Record<string, unknown>)[String(n)])))
  }

  const out: ParametrosDoModelo = { body }

  const cabecalho =
    textoDeParametro(await interpolar(texto(cfg.header_text), { cru: false })) ||
    textoDeParametro(texto(cfg.header_text_reserva))
  if (cabecalho) out.headerText = cabecalho

  const midia = texto(cfg.header_media_url).trim()
  if (midia) out.headerMediaUrl = midia

  const botoes: Record<number, string> = {}
  for (const i of Object.keys(cfg.button_params ?? {})) {
    if (!/^\d+$/.test(i)) continue
    // O final de um ENDEREÇO: o dado cru (sem "R$", data em ISO), com cada
    // valor substituído CODIFICADO (`/`, `?`, `#`, `&` ou acento de um
    // `{{contact.*}}` mudariam o endereço), e sem espaço nenhum no meio —
    // espaço não existe numa URL. O texto literal do operador fica como ele
    // escreveu: é ele quem monta o caminho.
    const bruto = texto((cfg.button_params as Record<string, unknown>)[i])
    const valor = (await interpolar(bruto, { cru: true, url: true })).replace(/\s+/g, '')
    if (valor) botoes[Number(i)] = valor
  }
  if (Object.keys(botoes).length > 0) out.buttonParams = botoes

  return out
}

/**
 * O que falta para a Meta aceitar este modelo com estes valores — a frase do
 * registro da automação —, ou `null` quando está tudo lá.
 *
 * Espelha o que `buildSendComponents` exige, dito em português e ANTES da
 * Meta: aquela função lança em inglês ("Body has 2 variable(s) but only 1
 * value(s) were supplied"), e a Meta, com a linha ausente, recusaria depois.
 *
 * Sem a linha local do modelo (conta que não sincronizou), não há como saber
 * o que o modelo pede: confere só que nenhum valor configurado saiu vazio (a
 * Meta recusa parâmetro vazio), e a Meta decide o resto.
 */
export function faltaNoModelo(
  modelo: MessageTemplate | null,
  p: ParametrosDoModelo
): string | null {
  const exigidas = modelo
    ? extractVariableIndices(modelo.body_text ?? '')
    : p.body.map((_, i) => i + 1)
  for (const n of exigidas) {
    if (!p.body[n - 1]) {
      return `a variável {{${n}}} do modelo ficou vazia e o passo não tem texto de reserva para ela`
    }
  }
  if (!modelo) return null

  if (
    modelo.header_type === 'text' &&
    extractVariableIndices(modelo.header_content ?? '').length > 0 &&
    !p.headerText
  ) {
    return 'a variável do cabeçalho do modelo ficou vazia e o passo não tem texto de reserva para ela'
  }
  if (
    (modelo.header_type === 'image' ||
      modelo.header_type === 'video' ||
      modelo.header_type === 'document') &&
    !p.headerMediaUrl &&
    !modelo.header_media_url
  ) {
    return `o modelo tem cabeçalho de ${ROTULO_DA_MIDIA[modelo.header_type]} sem arquivo guardado — escolha o arquivo no passo`
  }
  for (const [i, botao] of (modelo.buttons ?? []).entries()) {
    if (
      botao.type === 'URL' &&
      extractVariableIndices(botao.url).length > 0 &&
      !p.buttonParams?.[i]
    ) {
      return `o botão "${botao.text}" do modelo precisa do final do endereço, e ele ficou vazio`
    }
  }
  return null
}

/**
 * Os valores recortados ao que o modelo USA, para ir à Meta. Um valor só
 * SOBRA quando a linha do envio não é a que a tela mostrou (o modelo mudou na
 * Meta depois de o passo ser gravado, ou o mesmo nome existe noutra WABA), e
 * sobrando ele não pode viajar:
 *
 * - CORPO: com o modelo SEM variáveis e algum valor gravado,
 *   `buildSendComponents` emite `{ type: 'body', parameters: [] }` — ele só
 *   pula o corpo com as duas listas vazias —, e a Meta pode recusar o
 *   componente vazio. O corpo vai cortado ao número de `{{N}}` do modelo (o
 *   construtor já cortaria o excesso; o que muda é o caso do zero).
 * - BOTÕES: o construtor manda parâmetro para QUALQUER botão com valor — num
 *   botão de resposta rápida isso TROCA o `payload` que volta quando o
 *   cliente toca nele, e a automação que casa a resposta deixa de casar.
 *
 * O cabeçalho não precisa: o construtor já ignora o de texto sem variável e o
 * endereço de mídia num cabeçalho que não é de mídia.
 */
export function recortarAoModelo(
  modelo: MessageTemplate | null,
  p: ParametrosDoModelo
): ParametrosDoModelo {
  if (!modelo) return p
  const recortado: ParametrosDoModelo = {
    ...p,
    body: p.body.slice(0, extractVariableIndices(modelo.body_text ?? '').length),
  }
  delete recortado.buttonParams
  if (!p.buttonParams) return recortado
  const botoes = modelo.buttons ?? []
  const usados: Record<number, string> = {}
  for (const [i, valor] of Object.entries(p.buttonParams)) {
    const botao = botoes[Number(i)]
    if (botao?.type === 'URL' && extractVariableIndices(botao.url).length > 0) {
      usados[Number(i)] = valor
    }
  }
  if (Object.keys(usados).length > 0) recortado.buttonParams = usados
  return recortado
}

/**
 * A linha do modelo que a TELA mostra para um passo, e se o nome existe em
 * mais de um número (WABA).
 *
 * ⚠️ ESPELHO de `resolveTemplateRow` (`src/lib/whatsapp/template-body.ts`),
 * que decide a linha do ENVIO: com conexão no passo, a DAQUELE número, senão
 * as globais (`channel_id` nulo); sem conexão, qualquer uma. Idioma exato,
 * senão o de mesma base (`pt` × `pt_BR`). Divergir faz o operador preencher os
 * campos de um modelo e o envio usar outro (e `button_params` é pela POSIÇÃO
 * do botão). Mudou lá, muda aqui.
 *
 * `emVariosNumeros`: sem conexão no passo, a linha do envio é a do número do
 * DISPARO, que a tela não sabe qual é — com o nome em mais de um número, os
 * campos podem ser os do modelo errado, e a tela avisa.
 */
export function linhaDoModeloNaTela(
  modelos: MessageTemplate[],
  nome: string,
  idioma: string | null | undefined,
  canal: string | null
): { modelo: MessageTemplate | null; emVariosNumeros: boolean } {
  const todas = modelos
    .filter((m) => m.name === nome)
    .sort((a, b) => (a.language ?? '').localeCompare(b.language ?? ''))
  const doCanal = canal ? todas.filter((m) => m.channel_id === canal) : []
  const globais = canal ? todas.filter((m) => m.channel_id == null) : todas
  const linhas = doCanal.length > 0 ? doCanal : globais
  const emVariosNumeros =
    !canal && new Set(todas.map((m) => m.channel_id ?? null)).size > 1

  const base = (l: string) => l.toLowerCase().split(/[_-]/)[0]
  let modelo: MessageTemplate | undefined
  if (idioma) {
    const pedido = idioma.toLowerCase()
    modelo =
      linhas.find((m) => m.language?.toLowerCase() === pedido) ??
      linhas.find((m) => m.language && base(m.language) === base(idioma))
  } else {
    modelo =
      linhas.find((m) => m.language === 'en_US') ??
      linhas.find((m) => m.language === 'en') ??
      linhas[0]
  }
  return { modelo: modelo ?? null, emVariosNumeros }
}

const ROTULO_DA_MIDIA = {
  image: 'imagem',
  video: 'vídeo',
  document: 'documento',
} as const

// ============================================================
// O diálogo da ligação pelo CRM (4d, `docs/PLANO-ligar-pelo-crm.md` §8.5 e
// §8.16). Cada LADO da gravação (`cliente.ogg`, `atendente.ogg`) é transcrito
// à parte, com o instante em que cada trecho COMEÇA, e os dois se intercalam
// num diálogo Cliente/Atendente: os canais separados dizem quem falou, sem
// adivinhação. Puro: o pedido ao provedor, a leitura da resposta e o texto
// que vai ao resumo e ao contexto da IA.
//
// ⚠️ Os dois lados começam no MESMO instante — o corte do começo é um por
// arquivo e erra ~0,3 s (`maquina-de-ligacoes/src/gravacao.ts`). É isso que
// deixa comparar o horário de um lado com o do outro.
// ============================================================

import type { JsonSchema } from '@/lib/ai/structured';

export type Lado = 'cliente' | 'atendente';

/** Um trecho de fala do lado: quando começa (segundos desde o começo da gravação) e o texto. */
export type TrechoDoLado = { inicio: number; texto: string };

/** Um trecho do diálogo: quem falou, quando começa e o texto. */
export type Trecho = TrechoDoLado & { quem: Lado };

/**
 * OpenAI: só o `whisper-1` devolve trechos com horário (`verbose_json` com
 * `timestamp_granularities[]=segment`); os `gpt-*-transcribe` respondem só
 * `json` (texto inteiro). O Gemini usa o modelo da transcrição de hoje
 * (`MODELO_TRANSCRICAO`), com saída JSON.
 */
export const MODELO_DA_LIGACAO_OPENAI = 'whisper-1';

/** O pedido de UM lado: uma pessoa só fala nele. */
export const INSTRUCAO_DO_LADO =
  'Este áudio é UM lado de uma ligação telefônica: só uma pessoa fala nele. ' +
  'Transcreva a fala fielmente, em português do Brasil, em trechos curtos (uma frase ou fala por trecho), ' +
  'e dê para cada trecho o instante em que ele COMEÇA, contado do início do áudio, no formato MM:SS. ' +
  'Não resuma, não corrija, não invente. Trecho que não se entende: escreva [inaudível]. ' +
  'Sem nenhuma fala no áudio, devolva a lista vazia.';

/** A forma da resposta de um lado (o Gemini a recebe como `responseSchema`). */
export const ESQUEMA_DO_LADO: JsonSchema = {
  type: 'object',
  properties: {
    trechos: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          inicio: { type: 'string', description: 'MM:SS desde o começo do áudio' },
          texto: { type: 'string' },
        },
        required: ['inicio', 'texto'],
      },
    },
  },
  required: ['trechos'],
};

const HORARIO = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{1,2}(?:[.,]\d+)?)$/;

/**
 * "MM:SS", "M:SS", "H:MM:SS" (com fração opcional) ou número de segundos →
 * segundos. Qualquer outra coisa (negativo, vazio, "1 min") = `null`.
 */
export function segundosDe(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor >= 0 ? valor : null;
  if (typeof valor !== 'string') return null;
  const texto = valor.trim();
  if (/^\d+(?:[.,]\d+)?$/.test(texto)) return Number(texto.replace(',', '.'));
  const m = HORARIO.exec(texto);
  if (!m) return null;
  const horas = m[1] ? Number(m[1]) : 0;
  const minutos = Number(m[2]);
  const segundos = Number(m[3].replace(',', '.'));
  if (segundos >= 60 || (m[1] !== undefined && minutos >= 60)) return null;
  return horas * 3600 + minutos * 60 + segundos;
}

function trechosValidos(itens: unknown[]): TrechoDoLado[] {
  const trechos: TrechoDoLado[] = [];
  for (const item of itens) {
    const t = item as { inicio?: unknown; start?: unknown; texto?: unknown; text?: unknown } | null;
    const inicio = segundosDe(t?.inicio ?? t?.start);
    const bruto = typeof t?.texto === 'string' ? t.texto : typeof t?.text === 'string' ? t.text : '';
    const texto = bruto.replace(/\s+/g, ' ').trim();
    if (inicio === null || !texto) continue;
    trechos.push({ inicio, texto });
  }
  // Estável: dois trechos no mesmo segundo ficam na ordem em que vieram.
  return trechos.map((t, i) => ({ t, i })).sort((a, b) => a.t.inicio - b.t.inicio || a.i - b.i).map(({ t }) => t);
}

/**
 * A lista com FALA e nenhum trecho válido (o horário todo fora da forma) é
 * FALHA, nunca "lado sem fala": senão a ligação ficava pronta sem aquele lado.
 * Item sem texto não conta como fala.
 */
function validosOuFalha(itens: unknown[]): TrechoDoLado[] | null {
  const trechos = trechosValidos(itens);
  const comFala = itens.some((item) => {
    const t = item as { texto?: unknown; text?: unknown } | null;
    const texto = typeof t?.texto === 'string' ? t.texto : typeof t?.text === 'string' ? t.text : '';
    return texto.trim() !== '';
  });
  return comFala && trechos.length === 0 ? null : trechos;
}

/**
 * O texto JSON que o Gemini devolve (`{ trechos: [...] }`; uma lista solta
 * também serve). `null` = a resposta não tem a forma pedida (falha); `[]` =
 * o lado sem fala.
 */
export function lerTrechosDoGemini(texto: string): TrechoDoLado[] | null {
  // A saída JSON pedida vem crua; a cerca de código, se vier, não a estraga.
  const limpo = texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let dado: unknown;
  try {
    dado = JSON.parse(limpo);
  } catch {
    return null;
  }
  const lista = Array.isArray(dado) ? dado : (dado as { trechos?: unknown } | null)?.trechos;
  return Array.isArray(lista) ? validosOuFalha(lista) : null;
}

/**
 * O `verbose_json` do `whisper-1`: `{ text, segments: [{ start, end, text }] }`.
 * Sem `segments` e com `text`, o lado vira um trecho só, no começo. `null` =
 * nenhum dos dois (falha); texto vazio = o lado sem fala.
 */
export function lerTrechosDaOpenAi(corpo: unknown): TrechoDoLado[] | null {
  const d = corpo as { text?: unknown; segments?: unknown } | null;
  if (Array.isArray(d?.segments)) return validosOuFalha(d.segments);
  if (typeof d?.text !== 'string') return null;
  const texto = d.text.replace(/\s+/g, ' ').trim();
  return texto ? [{ inicio: 0, texto }] : [];
}

/**
 * Os dois lados num diálogo, pela ordem do horário. Trechos seguidos da mesma
 * pessoa viram um só (o horário é o do primeiro): o diálogo lê como turnos de
 * fala, e o contexto da IA gasta menos.
 */
export function intercalar(cliente: TrechoDoLado[], atendente: TrechoDoLado[]): Trecho[] {
  const todos = [
    ...cliente.map((t) => ({ ...t, quem: 'cliente' as const })),
    ...atendente.map((t) => ({ ...t, quem: 'atendente' as const })),
  ]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.inicio - b.t.inicio || a.i - b.i)
    .map(({ t }) => t);
  const dialogo: Trecho[] = [];
  for (const t of todos) {
    const anterior = dialogo[dialogo.length - 1];
    if (anterior && anterior.quem === t.quem) anterior.texto = `${anterior.texto} ${t.texto}`;
    else dialogo.push({ ...t });
  }
  return dialogo;
}

/** Segundos → "MM:SS" (ou "H:MM:SS" a partir de uma hora). */
export function relogio(segundos: number): string {
  const total = Math.max(0, Math.floor(segundos));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** O diálogo em linhas "[00:12] Cliente: …", para o resumo e o contexto da IA. */
export function dialogoEmTexto(trechos: Trecho[], rotulos: Record<Lado, string>): string {
  return trechos.map((t) => `[${relogio(t.inicio)}] ${rotulos[t.quem]}: ${t.texto}`).join('\n');
}

/** O resumo pedido sobre o diálogo (D11: 2–3 linhas). */
export const INSTRUCAO_DO_RESUMO =
  'Resuma esta ligação telefônica entre um cliente e um atendente em 2 ou 3 frases curtas, em português do Brasil: ' +
  'o assunto, o que ficou combinado e o próximo passo, se houver. ' +
  'Só o que foi dito na ligação, sem inventar. Sem saudação, sem título, sem marcadores.';

export const TETO_DO_RESUMO = 600;

/** O texto do provedor → o resumo gravado (aparado, com teto). Vazio = `null`. */
export function limparResumo(texto: string): string | null {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  if (!limpo) return null;
  return limpo.length > TETO_DO_RESUMO ? `${limpo.slice(0, TETO_DO_RESUMO - 1).trimEnd()}…` : limpo;
}

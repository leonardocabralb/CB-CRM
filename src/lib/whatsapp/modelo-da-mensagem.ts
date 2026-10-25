// ============================================================
// O modelo da Meta que uma mensagem ENVIOU, para a bolha mostrar o que o
// cliente viu além do corpo: o cabeçalho de texto, o rodapé e os botões.
//
// A mensagem guarda só o NOME do modelo (`template_name`) e o corpo já
// preenchido (`content_text`); o resto mora na linha local de
// `message_templates`, lida pela bolha (`use-modelos-da-conta.ts`). Adaptado
// do #659 do original (`template-message-view.ts`), com três diferenças:
//
// · O recorte por CANAL de `resolveTemplateRow` (`whatsapp-envio.md`): o
//   catálogo é POR WABA, e o mesmo nome pode existir em dois números com
//   botões diferentes. Vale o modelo do canal da mensagem; sem ele, o global
//   (sem canal); o de OUTRO canal, nunca. Mensagem sem canal (histórico
//   anterior ao multi-canal) enxerga todos, como `resolveTemplateRow` sem
//   canal.
// · Vários candidatos (idiomas) e nenhum corpo que case = NENHUM: o original
//   ficava com o primeiro, e a bolha mostraria os botões de outra tradução.
//   O casamento do corpo é por PEDAÇOS LITERAIS, sem regex: com uma regex de
//   curingas, um corpo de muitas variáveis que NÃO casa leva o navegador a
//   um retrocesso exponencial.
// · O cabeçalho de MÍDIA não se desenha: a mensagem não guarda a URL do
//   arquivo que saiu (o original passou a gravá-la em `messages.media_url`;
//   aqui não), e a amostra do modelo (`header_media_url`) não é o que o
//   cliente recebeu.
//
// ⚠️ Cabeçalho de texto COM variável (`{{1}}`) fica de fora inteiro: o valor
// que saiu nele não é gravado em lugar nenhum, e o `{{1}}` cru (o original o
// mostra) pareceria um envio quebrado — a bolha só afirma o que o cliente viu.
//
// Puro. Nada que case = `null`, e a bolha fica como sempre foi.
// ============================================================

import type { Message } from '@/types';

/** As colunas de `message_templates` que a bolha lê (o hook pede só estas). */
export interface ModeloDoCatalogo {
  name: string;
  language: string | null;
  channel_id: string | null;
  header_type: string | null;
  header_content: string | null;
  footer_text: string | null;
  /** JSONB: lido campo a campo por `lerBotoes`, nunca por `as`. */
  buttons: unknown;
  body_text: string | null;
}

export type TipoDeBotao = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE';

export interface BotaoDoModelo {
  tipo: TipoDeBotao;
  texto: string;
}

export interface PartesDoModelo {
  cabecalho: string | null;
  rodape: string | null;
  botoes: BotaoDoModelo[];
}

const TIPOS_DE_BOTAO: readonly TipoDeBotao[] = [
  'QUICK_REPLY',
  'URL',
  'PHONE_NUMBER',
  'COPY_CODE',
];

function ehTipoDeBotao(tipo: unknown): tipo is TipoDeBotao {
  return TIPOS_DE_BOTAO.some((t) => t === tipo);
}

const VARIAVEL = /\{\{[^{}]*\}\}/;
const VARIAVEIS = /\{\{[^{}]*\}\}/g;

function textoOuNulo(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const aparado = valor.trim();
  return aparado ? aparado : null;
}

/**
 * O corpo do modelo, com cada variável valendo QUALQUER trecho (até vazio),
 * explica o texto? Cada pedaço literal é achado na ordem, o primeiro no
 * começo e o último no fim; para curinga do tipo "qualquer trecho", ficar com
 * a ocorrência mais à esquerda de cada pedaço nunca perde um casamento que
 * exista.
 */
export function corpoExplicaOTexto(corpo: string, texto: string): boolean {
  const pedacos = corpo.split(VARIAVEIS);
  if (pedacos.length === 1) return corpo === texto;
  const primeiro = pedacos[0];
  const ultimo = pedacos[pedacos.length - 1];
  const fim = texto.length - ultimo.length;
  if (!texto.startsWith(primeiro) || !texto.endsWith(ultimo)) return false;
  if (fim < primeiro.length) return false;
  let pos = primeiro.length;
  for (const meio of pedacos.slice(1, -1)) {
    const achado = texto.indexOf(meio, pos);
    if (achado < 0 || achado + meio.length > fim) return false;
    pos = achado + meio.length;
  }
  return true;
}

/** Ordem fixa entre candidatos (sem colação: o desempate não pode variar). */
function porIdioma(a: ModeloDoCatalogo, b: ModeloDoCatalogo): number {
  const x = `${a.language ?? ''}|${a.channel_id ?? ''}`;
  const y = `${b.language ?? ''}|${b.channel_id ?? ''}`;
  return x < y ? -1 : x > y ? 1 : 0;
}

/** A linha local do modelo que a mensagem enviou, ou `null`. */
export function modeloDaMensagem(
  mensagem: Pick<Message, 'template_name' | 'channel_id' | 'content_text'>,
  catalogo: readonly ModeloDoCatalogo[]
): ModeloDoCatalogo | null {
  const nome = mensagem.template_name;
  if (!nome) return null;
  const porNome = catalogo.filter((m) => m.name === nome);
  const canal = mensagem.channel_id ?? null;
  let candidatos = porNome;
  if (canal) {
    const doCanal = porNome.filter((m) => m.channel_id === canal);
    candidatos =
      doCanal.length > 0
        ? doCanal
        : porNome.filter((m) => m.channel_id == null);
  }
  if (candidatos.length <= 1) return candidatos[0] ?? null;
  const texto = mensagem.content_text;
  if (!texto) return null;
  return (
    [...candidatos]
      .sort(porIdioma)
      .find((m) => corpoExplicaOTexto(m.body_text ?? '', texto)) ?? null
  );
}

function lerBotoes(bruto: unknown): BotaoDoModelo[] {
  if (!Array.isArray(bruto)) return [];
  const botoes: BotaoDoModelo[] = [];
  for (const item of bruto) {
    if (!item || typeof item !== 'object') continue;
    const { type, text } = item as { type?: unknown; text?: unknown };
    const tipo = typeof type === 'string' ? type.toUpperCase() : null;
    const texto = textoOuNulo(text);
    // Tipo que não sabemos desenhar (OTP, FLOW…) a sincronização já descarta;
    // aqui também — e botão sem rótulo afirmaria um texto que não existe.
    if (texto && ehTipoDeBotao(tipo)) botoes.push({ tipo, texto });
  }
  return botoes;
}

/**
 * O que a bolha acrescenta ao corpo: cabeçalho de texto, rodapé e botões.
 * `null` quando o modelo não tem nada disso (ou não há modelo).
 */
export function partesDoModelo(
  modelo: ModeloDoCatalogo | null
): PartesDoModelo | null {
  if (!modelo) return null;
  const tipoDoCabecalho =
    typeof modelo.header_type === 'string'
      ? modelo.header_type.toLowerCase()
      : null;
  const textoDoCabecalho =
    tipoDoCabecalho === 'text' ? textoOuNulo(modelo.header_content) : null;
  const cabecalho =
    textoDoCabecalho && !VARIAVEL.test(textoDoCabecalho)
      ? textoDoCabecalho
      : null;
  const rodape = textoOuNulo(modelo.footer_text);
  const botoes = lerBotoes(modelo.buttons);
  if (!cabecalho && !rodape && botoes.length === 0) return null;
  return { cabecalho, rodape, botoes };
}

// ============================================================
// Anexos da anotação interna (1102) — puro: sem rede, sem React.
//
// A régua que a caixa usa antes de subir, que a rota `POST /api/cb/notes`
// usa antes de gravar e que as telas e a API v1 usam para mostrar. As pontas
// leem DAQUI de propósito: uma lista de tipos escrita duas vezes diverge na
// primeira adição, e o arquivo aceito numa porta falha só na outra.
//
// O que a anotação guarda é o CAMINHO no `chat-media`
// (`account-<conta>/notas/<único>/<nome>`), nunca a URL: a URL nasce na tela
// (`urlPublicaDoAnexo`), e virar o bucket privado um dia (decisão A1, adiada)
// não exige migrar dado. Tamanho e tipo vêm do ARMAZENAMENTO, lidos pela rota
// (`conferirAnexo`); do corpo do pedido só o caminho e o nome.
// ============================================================

import { MIMES_POR_TIPO } from '@/lib/acervo/tipos';
import {
  MAX_ANEXOS,
  MIMES_SO_POR_QR_CODE,
  mimeNormalizado,
} from '@/lib/inbox/arquivo-solto';
import { CHAT_MEDIA_BUCKET } from '@/lib/storage/buckets';
import { caminhoNoChatMedia } from '@/lib/storage/caminho-no-chat-media';
import { buildMediaPath } from '@/lib/storage/media-path';

/** A subpasta das anotações, abaixo de `account-<conta>/` (regras da 1102). */
export const SUBPASTA_DAS_NOTAS = 'notas';

/**
 * Teto por arquivo (A7): 50 MiB, o `file_size_limit` do próprio bucket
 * (986). A anotação não vai à Meta, então os tetos de envio do compositor
 * (imagem 5 MB; o resto 16 MB) não valem aqui. Amarrado a
 * `MEDIA_MAX_BYTES_ENTRADA` pelo teste.
 */
export const TETO_DO_ANEXO = 50 * 1024 * 1024;

/**
 * Até 10 anexos por anotação — o `MAX_ANEXOS` do compositor. O número vive
 * também no CHECK `cb_conversation_notes_anexos_ck` da 1102 (o teste lê o
 * SQL): mudar um sem o outro faz a rota aceitar o que o banco recusa.
 */
export const MAX_ANEXOS_DA_NOTA = MAX_ANEXOS;

/** Teto do NOME gravado (o nome vem do corpo do pedido; o arquivo, não). */
export const MAX_NOME_DO_ANEXO = 200;

/** Gravação de até 5 min — a do compositor (padrão aceito em 23/10/2026). */
export const MAX_SEGUNDOS_DA_GRAVACAO = 5 * 60;

/**
 * Os tipos que a anotação aceita (D3): os do acervo — que é o ESPELHO da
 * `allowed_mime_types` do bucket (023) — mais a página `.html`
 * (`MIMES_SO_POR_QR_CODE`, que o bucket aceita desde a 1060). Não passa pela
 * régua das conexões: a anotação não sai ao cliente, então o `.html` não
 * depende de QR code aqui. Uma lista só (`midia.md`).
 */
export const MIMES_DA_ANOTACAO: readonly string[] = [
  ...MIMES_POR_TIPO.audio,
  ...MIMES_POR_TIPO.image,
  ...MIMES_POR_TIPO.video,
  ...MIMES_POR_TIPO.document,
  ...MIMES_SO_POR_QR_CODE,
];

/** O `accept=` do clipe da caixa, derivado da MESMA lista. */
export const ACEITE_DA_ANOTACAO = MIMES_DA_ANOTACAO.join(',');

/** Como cada anexo é DESENHADO (e resumido no aviso). */
export type TipoDoAnexo = 'audio' | 'imagem' | 'video' | 'documento';

/** `null` = tipo que a anotação não aceita. */
export function tipoDoAnexo(
  mime: string | null | undefined
): TipoDoAnexo | null {
  const limpo = mimeNormalizado(mime);
  if (!limpo) return null;
  if (MIMES_POR_TIPO.audio.includes(limpo)) return 'audio';
  if (MIMES_POR_TIPO.image.includes(limpo)) return 'imagem';
  if (MIMES_POR_TIPO.video.includes(limpo)) return 'video';
  if (
    MIMES_POR_TIPO.document.includes(limpo) ||
    MIMES_SO_POR_QR_CODE.includes(limpo)
  )
    return 'documento';
  return null;
}

/** Um anexo como a anotação o GUARDA (`cb_conversation_notes.anexos`). */
export interface AnexoDaNota {
  /** No `chat-media`: `account-<conta>/notas/<único>/<nome>`. */
  caminho: string;
  /** O nome que a pessoa deu ao arquivo (o do caminho é degradado). */
  nome: string;
  /** Lido do armazenamento pela rota. */
  mime: string;
  /** Lido do armazenamento pela rota. */
  bytes: number;
}

export function prefixoDasNotas(conta: string): string {
  return `account-${conta}/${SUBPASTA_DAS_NOTAS}/`;
}

/**
 * Onde o arquivo sobe: uma pasta por arquivo (`único` = um UUID novo), com
 * o nome do arquivo no fim, na forma de `buildMediaPath` (acento e espaço
 * viram `_`). A pasta própria é o que torna o caminho único sem estragar o
 * nome: é ele que o navegador sugere ao baixar o PDF aberto numa aba.
 */
export function caminhoDoAnexoDaNota(
  conta: string,
  nome: string,
  unico: string
): string {
  return buildMediaPath(conta, nome, null, `${SUBPASTA_DAS_NOTAS}/${unico}`);
}

/** O último pedaço do caminho — o nome quando nada melhor existe. */
function nomeDoCaminho(caminho: string): string {
  return caminho.slice(caminho.lastIndexOf('/') + 1) || 'arquivo';
}

/** O nome do corpo, aparado, sem caractere de controle e com teto. */
function nomeDoPedido(nome: string, caminho: string): string {
  const limpo = nome.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (limpo || nomeDoCaminho(caminho)).slice(0, MAX_NOME_DO_ANEXO);
}

/** O que o corpo do POST traz de cada anexo: o resto o servidor LÊ. */
export interface AnexoPedido {
  caminho: string;
  nome: string;
}

export type ErroDosAnexos =
  | 'ATTACHMENTS_INVALID'
  | 'TOO_MANY_ATTACHMENTS'
  | 'ATTACHMENT_OUTSIDE_ACCOUNT'
  | 'ATTACHMENT_REPEATED';

export type LeituraDosAnexos =
  | { ok: true; anexos: AnexoPedido[] }
  | { ok: false; erro: ErroDosAnexos };

/**
 * Os anexos pedidos no corpo do `POST /api/cb/notes`.
 *
 * Ausente ou nulo = nenhum. Cada item é `{ caminho, nome }`, com o caminho
 * DESTA conta em `notas/` e que passa na guarda da 1097
 * (`caminhoNoChatMedia`: sem `..`, `%`, barra sobrando) — a mesma régua que
 * o gatilho da 1102 usa para pôr o arquivo na fila, então todo caminho
 * gravado é um caminho que a limpeza alcança. Repetido é recusado (a mesma
 * linha duas vezes desenharia o anexo duas vezes e contaria no teto).
 */
export function lerAnexosDoCorpo(
  valor: unknown,
  conta: string
): LeituraDosAnexos {
  if (valor === undefined || valor === null) return { ok: true, anexos: [] };
  if (!Array.isArray(valor)) return { ok: false, erro: 'ATTACHMENTS_INVALID' };
  if (valor.length > MAX_ANEXOS_DA_NOTA)
    return { ok: false, erro: 'TOO_MANY_ATTACHMENTS' };
  const prefixo = prefixoDasNotas(conta);
  const vistos = new Set<string>();
  const anexos: AnexoPedido[] = [];
  for (const item of valor) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      return { ok: false, erro: 'ATTACHMENTS_INVALID' };
    const { caminho, nome } = item as Record<string, unknown>;
    if (typeof caminho !== 'string' || typeof nome !== 'string')
      return { ok: false, erro: 'ATTACHMENTS_INVALID' };
    if (
      caminhoNoChatMedia(caminho, conta) !== caminho ||
      !caminho.startsWith(prefixo)
    )
      return { ok: false, erro: 'ATTACHMENT_OUTSIDE_ACCOUNT' };
    if (vistos.has(caminho)) return { ok: false, erro: 'ATTACHMENT_REPEATED' };
    vistos.add(caminho);
    anexos.push({ caminho, nome: nomeDoPedido(nome, caminho) });
  }
  return { ok: true, anexos };
}

export type ConferenciaDoAnexo =
  | { ok: true; anexo: AnexoDaNota }
  | { ok: false; erro: 'ATTACHMENT_TYPE_REFUSED' | 'ATTACHMENT_TOO_LARGE' };

/**
 * O anexo pedido, com o que o ARMAZENAMENTO diz dele (nunca o corpo): o tipo
 * tem de estar na lista da anotação e o tamanho no teto. O tipo gravado é o
 * normalizado (sem parâmetro), como o que subiu.
 */
export function conferirAnexo(
  pedido: AnexoPedido,
  lido: { bytes: number; mime: string }
): ConferenciaDoAnexo {
  const mime = mimeNormalizado(lido.mime);
  if (!MIMES_DA_ANOTACAO.includes(mime))
    return { ok: false, erro: 'ATTACHMENT_TYPE_REFUSED' };
  if (lido.bytes > TETO_DO_ANEXO)
    return { ok: false, erro: 'ATTACHMENT_TOO_LARGE' };
  return {
    ok: true,
    anexo: { caminho: pedido.caminho, nome: pedido.nome, mime, bytes: lido.bytes },
  };
}

/**
 * Os anexos GRAVADOS, para mostrar — lidos campo a campo: o JSON vem do
 * banco (e do tempo real), e a tela nunca confia na forma. Item sem caminho
 * some; nome ausente vira o fim do caminho; tamanho ilegível, zero.
 */
export function lerAnexosDaNota(valor: unknown): AnexoDaNota[] {
  if (!Array.isArray(valor)) return [];
  const saida: AnexoDaNota[] = [];
  for (const item of valor) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const { caminho, nome, mime, bytes } = item as Record<string, unknown>;
    if (typeof caminho !== 'string' || !caminho) continue;
    saida.push({
      caminho,
      nome:
        typeof nome === 'string' && nome.trim()
          ? nome
          : nomeDoCaminho(caminho),
      mime: typeof mime === 'string' ? mime : '',
      bytes: typeof bytes === 'number' && Number.isFinite(bytes) ? bytes : 0,
    });
  }
  return saida;
}

/**
 * A URL pública do arquivo, DERIVADA do caminho — na forma exata de
 * `getPublicUrl` do storage-js (`encodeURI` sobre
 * `<projeto>/storage/v1/object/public/<bucket>/<caminho>`): a mesma URL que
 * o resto do CRM gera, e o player guarda a onda por endereço. Nunca gravada.
 */
export function urlPublicaDoAnexo(
  caminho: string,
  base: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
): string {
  return encodeURI(
    `${base.replace(/\/+$/, '')}/storage/v1/object/public/${CHAT_MEDIA_BUCKET}/${caminho}`
  );
}

/** O resumo de uma anotação com anexos: um só (pelo tipo) ou vários. */
export type ResumoDosAnexos =
  | { tipo: TipoDoAnexo; quantos: 1; nome: string }
  | { tipo: 'varios'; quantos: number };

export function resumoDosAnexos(
  anexos: readonly AnexoDaNota[]
): ResumoDosAnexos | null {
  if (anexos.length === 0) return null;
  if (anexos.length > 1) return { tipo: 'varios', quantos: anexos.length };
  const [anexo] = anexos;
  return {
    tipo: tipoDoAnexo(anexo.mime) ?? 'documento',
    quantos: 1,
    nome: anexo.nome,
  };
}

/**
 * O resumo em texto CRU, em português — o que a rota grava no corpo do aviso
 * (o título já é cru: `notifications.title`/`body` são TEXT, no idioma de
 * quem escreveu). A tela desenha o mesmo resumo pelo dicionário
 * (`<ResumoDosAnexos>`).
 */
export function textoDoResumo(resumo: ResumoDosAnexos): string {
  switch (resumo.tipo) {
    case 'audio':
      return '🎤 Áudio';
    case 'imagem':
      return '🖼️ Imagem';
    case 'video':
      return '🎬 Vídeo';
    case 'documento':
      return `📄 ${resumo.nome}`;
    case 'varios':
      return `📎 ${resumo.quantos} anexos`;
  }
}

/** O teto do corpo do aviso (o mesmo de antes dos anexos). */
export const TETO_DO_CORPO_DO_AVISO = 280;

/**
 * O corpo do aviso (sino e pop-up do navegador): o texto e, depois dele, o
 * resumo dos anexos ("@Fulano confere · 🎤 Áudio"). Sem texto, só o resumo.
 * O resumo nunca é cortado: o texto encolhe para ele caber no teto.
 */
export function corpoDoAviso(
  texto: string,
  anexos: readonly AnexoDaNota[]
): string {
  const limpo = texto.trim();
  const resumo = resumoDosAnexos(anexos);
  if (!resumo) return limpo.slice(0, TETO_DO_CORPO_DO_AVISO);
  const sufixo = textoDoResumo(resumo);
  if (!limpo) return sufixo.slice(0, TETO_DO_CORPO_DO_AVISO);
  const junta = ' · ';
  const espaco = TETO_DO_CORPO_DO_AVISO - junta.length - sufixo.length;
  if (espaco <= 0) return sufixo.slice(0, TETO_DO_CORPO_DO_AVISO);
  return `${limpo.slice(0, espaco).trimEnd()}${junta}${sufixo}`;
}

/** O tamanho para a tela ("820 KB", "3,4 MB"), no formato de número de quem vê. */
export function tamanhoLegivel(bytes: number): string {
  const mib = 1024 * 1024;
  if (bytes >= mib) {
    return `${(bytes / mib).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(undefined)} KB`;
}

/** O nome da gravação feita na caixa (o carimbo é o do relógio, em UTC). */
export function nomeDaGravacao(agora: Date): string {
  const carimbo = agora
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `audio-${carimbo}.ogg`;
}

export interface EscolhaDeAnexos {
  /** Os que entram, na ordem em que vieram. */
  aceitos: File[];
  /** Tipo que a anotação não aceita. */
  recusados: number;
  /** Passam do teto por arquivo. */
  grandes: number;
  /** Passaram dos 10 por anotação. */
  excedentes: number;
}

/**
 * Reparte o que chegou à caixa (clipe, colar, arrastar, gravar): o que entra,
 * o que não serve, o que é grande demais e o que passou do teto — cada um
 * vira um aviso diferente (engolir arquivo em silêncio é o que faz alguém
 * achar que anexou o que não anexou). O teto vale para o TOTAL da anotação.
 * Os arquivos já vêm por `arquivoParaEnviar` (nome e tipo normalizados).
 */
export function escolherAnexosDaNota(
  arquivos: readonly File[],
  jaEscolhidos: number
): EscolhaDeAnexos {
  const validos: File[] = [];
  let recusados = 0;
  let grandes = 0;
  for (const arquivo of arquivos) {
    if (tipoDoAnexo(arquivo.type) === null) recusados += 1;
    else if (arquivo.size > TETO_DO_ANEXO) grandes += 1;
    else validos.push(arquivo);
  }
  const vagas = Math.max(0, MAX_ANEXOS_DA_NOTA - jaEscolhidos);
  return {
    aceitos: validos.slice(0, vagas),
    recusados,
    grandes,
    excedentes: Math.max(0, validos.length - vagas),
  };
}

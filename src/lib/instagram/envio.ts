// ============================================================
// O que cabe numa resposta pelo Instagram Direct (Fase 4) — puro, sem I/O,
// importado pelo núcleo de envio, pelas rotas de agendar e pelo compositor.
//
// A régua é a doc da API de mensagens do Instagram (lida em 21/11/2026):
//   · texto em UTF-8 até 1000 BYTES (não caracteres: acento e emoji pesam
//     mais de um), já com a assinatura;
//   · imagem png/jpeg até 8 MB; vídeo mp4/ogg/avi/mov/webm, áudio
//     aac/m4a/wav/mp4 e arquivo SÓ PDF até 25 MB (o nosso teto de envio, 16
//     MB, vale antes);
//   · anexo NÃO leva legenda: texto e anexo são mensagens separadas no Direct.
//     Decisão do operador (21/11/2026): o campo de legenda some na conversa do
//     Instagram, e o servidor recusa a que chegar por outro caminho;
//   · citar (`reply_to`) cabe — revisão do D5 de 10/09, pela doc nova;
//   · modelo e mensagem interativa não existem no Direct.
//
// A janela: o Direct só aceita resposta até 24 h depois da última mensagem
// da PESSOA, e só ela a reabre (não há modelo). O Human Agent (7 dias) fica
// fora até a Meta aprovar a feature (D2; decisão de 21/11/2026).
// ============================================================

import type { TipoDeAnexoDoDirect } from './graph';

export const TETO_DO_TEXTO_DO_DIRECT = 1000;
export const TETO_DA_IMAGEM_DO_DIRECT = 8 * 1024 * 1024;
export const HORAS_DA_JANELA_DO_DIRECT = 24;

/** A classe de mídia do CRM (`messages.content_type`) que o Direct aceita. */
type ClasseDoCrm = 'image' | 'video' | 'audio' | 'document';

const TIPO_NO_DIRECT: Record<ClasseDoCrm, TipoDeAnexoDoDirect> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'file',
};

const EXTENSOES: Record<ClasseDoCrm, readonly string[]> = {
  // `jfif` e `jpe` também são JPEG (o Windows salva assim): o compositor
  // aceita pelo MIME `image/jpeg`, e o servidor não pode recusar o mesmo
  // arquivo pela extensão (revisão do PR #539).
  image: ['png', 'jpg', 'jpeg', 'jpe', 'jfif'],
  video: ['mp4', 'ogg', 'avi', 'mov', 'webm'],
  audio: ['aac', 'm4a', 'wav', 'mp4'],
  document: ['pdf'],
};

const MIMES: Record<ClasseDoCrm, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/jpg'],
  video: [
    'video/mp4',
    'video/ogg',
    'video/x-msvideo',
    'video/avi',
    'video/quicktime',
    'video/webm',
  ],
  audio: [
    'audio/aac',
    'audio/x-aac',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
  ],
  document: ['application/pdf'],
};

/** Por que a mensagem não cabe no Direct. */
export type RecusaDoDirect =
  | 'tipo'
  | 'texto_longo'
  | 'legenda'
  | 'formato_imagem'
  | 'formato_video'
  | 'formato_audio'
  | 'formato_documento'
  | 'imagem_grande';

/**
 * As frases do servidor (núcleo, agendamento): vão para a bolha, para a
 * coluna `error` da agendada e para a API v1. A tela do compositor tem as
 * suas, nos dicionários, e recusa ANTES de chegar aqui.
 */
export const FRASES_DO_DIRECT: Record<RecusaDoDirect, string> = {
  tipo: 'O Instagram Direct não tem modelos nem mensagens com botões: responda com texto, imagem, vídeo, áudio ou PDF.',
  texto_longo:
    'A mensagem passa do limite do Instagram (1000 bytes, contando a assinatura; acento e emoji pesam mais). Divida em duas.',
  legenda:
    'No Instagram o anexo não leva legenda: mande o arquivo e escreva o texto numa mensagem separada.',
  formato_imagem: 'O Instagram só aceita imagem PNG ou JPEG.',
  formato_video: 'O Instagram só aceita vídeo MP4, OGG, AVI, MOV ou WEBM.',
  formato_audio: 'O Instagram só aceita áudio AAC, M4A, WAV ou MP4.',
  formato_documento: 'No Instagram, o único documento aceito é PDF.',
  imagem_grande: 'O Instagram só aceita imagem de até 8 MB.',
};

const RECUSA_DE_FORMATO: Record<ClasseDoCrm, RecusaDoDirect> = {
  image: 'formato_imagem',
  video: 'formato_video',
  audio: 'formato_audio',
  document: 'formato_documento',
};

function ehClasseDoCrm(t: string): t is ClasseDoCrm {
  return t === 'image' || t === 'video' || t === 'audio' || t === 'document';
}

/** Tamanho do texto em bytes UTF-8 — a medida da Meta. */
export function bytesDoTexto(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

/**
 * A extensão do arquivo: do nome, senão do caminho da URL ou do caminho no
 * Storage (os dois terminam na extensão). Minúscula, sem o ponto; `null` sem
 * extensão.
 */
export function extensaoDoArquivo(
  filename: string | null | undefined,
  urlOuCaminho: string | null | undefined
): string | null {
  const daUrl = (() => {
    if (!urlOuCaminho) return null;
    let caminho = urlOuCaminho;
    try {
      caminho = new URL(urlOuCaminho).pathname;
    } catch {
      // Não é URL: é o caminho no bucket (`account-<conta>/…/arquivo.pdf`).
    }
    try {
      return decodeURIComponent(caminho.split('/').pop() ?? '');
    } catch {
      return caminho.split('/').pop() ?? null;
    }
  })();
  for (const nome of [filename, daUrl]) {
    if (!nome) continue;
    const m = /\.([a-z0-9]{1,5})$/i.exec(nome.trim());
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export type ConferenciaDoDirect =
  | { ok: true; anexo: TipoDeAnexoDoDirect | null }
  | { ok: false; recusa: RecusaDoDirect };

/**
 * A mensagem, como o núcleo vai mandá-la, cabe no Direct? `texto` é o que sai
 * (no texto puro, JÁ assinado).
 *
 * Anexo sem extensão reconhecível é recusado: sem ela não há como saber se é o
 * PDF que o Direct aceita, e a recusa da Meta chegaria sem explicar por quê.
 */
export function conferirParaODirect(args: {
  tipo: string;
  texto: string | null | undefined;
  mediaUrl?: string | null;
  filename?: string | null;
}): ConferenciaDoDirect {
  const { tipo, texto } = args;
  if (tipo === 'text') {
    if (texto && bytesDoTexto(texto) > TETO_DO_TEXTO_DO_DIRECT) {
      return { ok: false, recusa: 'texto_longo' };
    }
    return { ok: true, anexo: null };
  }
  if (!ehClasseDoCrm(tipo)) return { ok: false, recusa: 'tipo' };
  if (texto && texto.trim()) return { ok: false, recusa: 'legenda' };
  const ext = extensaoDoArquivo(args.filename, args.mediaUrl);
  if (!ext || !EXTENSOES[tipo].includes(ext)) {
    return { ok: false, recusa: RECUSA_DE_FORMATO[tipo] };
  }
  return { ok: true, anexo: TIPO_NO_DIRECT[tipo] };
}

/**
 * O arquivo que o compositor vai anexar cabe no Direct? Pelo MIME do
 * navegador e pelo tamanho, antes de subir. `null` = cabe.
 */
export function arquivoCabeNoDirect(
  classe: string,
  mime: string,
  bytes: number
): RecusaDoDirect | null {
  if (!ehClasseDoCrm(classe)) return 'tipo';
  const base = mime.split(';')[0].trim().toLowerCase();
  if (!MIMES[classe].includes(base)) return RECUSA_DE_FORMATO[classe];
  if (classe === 'image' && bytes > TETO_DA_IMAGEM_DO_DIRECT) {
    return 'imagem_grande';
  }
  return null;
}

/**
 * A extensão de cada MIME de `MIMES`, para o nome do arquivo que chega sem
 * ela. Pino em `envio.test.ts`: todo MIME aceito tem extensão aceita na MESMA
 * classe.
 */
const EXTENSAO_DO_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'video/mp4': 'mp4',
  'video/ogg': 'ogg',
  'video/x-msvideo': 'avi',
  'video/avi': 'avi',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/aac': 'aac',
  'audio/x-aac': 'aac',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'application/pdf': 'pdf',
};

/**
 * O nome com que o arquivo sobe para o Direct: o mesmo, ou com a extensão do
 * MIME quando ele não traz uma que o Direct aceite.
 *
 * ⚠️ O compositor aceita pelo MIME (`arquivoCabeNoDirect`) e o servidor
 * confere pela EXTENSÃO do nome ou do caminho (`conferirParaODirect`). Uma
 * foto chamada só "foto" subia como `foto.bin` (`buildMediaPath`): passava
 * numa ponta e era recusada na outra (revisão do PR #539).
 */
export function nomeComExtensaoDoDirect(
  classe: string,
  nome: string,
  mime: string
): string {
  if (!ehClasseDoCrm(classe)) return nome;
  const ext = extensaoDoArquivo(nome, null);
  if (ext && EXTENSOES[classe].includes(ext)) return nome;
  const daMime = EXTENSAO_DO_MIME[mime.split(';')[0].trim().toLowerCase()];
  if (!daMime || !EXTENSOES[classe].includes(daMime)) return nome;
  return `${nome.trim() || 'arquivo'}.${daMime}`;
}

/**
 * Os MIMEs aceitos por classe: o pino de `EXTENSAO_DO_MIME` e a lista das
 * portas do compositor no Direct (`MIMES_PELO_DIRECT`, `arquivo-solto.ts`).
 */
export const MIMES_DO_DIRECT: Readonly<Record<ClasseDoCrm, readonly string[]>> =
  MIMES;

/**
 * A janela do Direct está aberta, contada da última mensagem da PESSOA por
 * esta conexão? Sem mensagem dela, fechada: só ela abre a conversa.
 */
export function janelaDoDirectAberta(
  ultimaDoClienteEm: string | null,
  agora: Date
): boolean {
  if (!ultimaDoClienteEm) return false;
  const quando = new Date(ultimaDoClienteEm).getTime();
  if (!Number.isFinite(quando)) return false;
  return agora.getTime() - quando < HORAS_DA_JANELA_DO_DIRECT * 3_600_000;
}

/** A frase de quando a janela do Direct fechou. */
export const FRASE_JANELA_DO_DIRECT_FECHADA =
  'A janela de 24 horas do Instagram fechou. No Direct só a pessoa reabre a conversa, mandando uma nova mensagem.';

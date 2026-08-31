// ============================================================
// Acervo de mídias (migration 953) — o que entra e como se chama.
//
// Puro, sem React e sem I/O: é a régua que a tela de Configurações usa antes
// de subir o arquivo e que a rota usa antes de gravar a linha. As duas pontas
// leem daqui de propósito — a validação do navegador é conveniência, a do
// servidor é a que vale, e uma tabela de mimes escrita duas vezes divergiria
// na primeira adição.
// ============================================================

/** Os quatro tipos que o compositor sabe enviar (`ComposerMediaKind`). */
export type TipoDeMidia = 'image' | 'video' | 'document' | 'audio';

export const TIPOS_DE_MIDIA: readonly TipoDeMidia[] = [
  'image',
  'video',
  'document',
  'audio',
] as const;

/**
 * ⚠️ ESPELHO da `allowed_mime_types` do bucket `chat-media` (migration 023).
 *
 * Mime fora desta lista é recusado pelo próprio Storage, com um erro que na
 * tela vira "falha no upload" sem dizer por quê. Conferir aqui antes é o que
 * transforma isso em "este tipo de arquivo não é aceito pelo WhatsApp".
 *
 * Quem alargar a lista mexe NOS DOIS lugares — aqui e numa migration que
 * atualize o bucket. Alargar só aqui faz o upload falhar no Storage; alargar
 * só lá faz a tela recusar um arquivo que o WhatsApp aceitaria.
 */
export const MIMES_POR_TIPO: Record<TipoDeMidia, readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp'],
  video: ['video/mp4', 'video/3gpp'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
  ],
  // ⚠️ Só os que a Meta aceita na SAÍDA. O navegador grava WebM/Opus, que não
  // está aqui: o gravador do compositor já converte para Ogg antes de subir, e
  // um arquivo `.webm` escolhido à mão precisa mesmo ser recusado.
  audio: ['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/mp4', 'audio/amr'],
};

/** Todo mime aceito, achatado — serve ao `accept=` do seletor de arquivo. */
export const MIMES_ACEITOS: readonly string[] = TIPOS_DE_MIDIA.flatMap(
  (t) => MIMES_POR_TIPO[t] as string[]
);

export const ACCEPT_DO_SELETOR = MIMES_ACEITOS.join(',');

/**
 * O tipo de acervo de um arquivo, pelo mime que o navegador declarou.
 *
 * `null` = não aceito. Devolver null em vez de chutar por extensão é
 * deliberado: o Storage vai recusar de qualquer jeito, e "chutar" só adiaria a
 * recusa para depois do upload, com o arquivo já no bucket.
 *
 * ⚠️ Compara em minúsculas e sem os parâmetros do mime: navegador manda
 * `text/plain; charset=utf-8` para .txt, e a comparação crua rejeitaria.
 */
export function tipoPeloMime(mime: string | null | undefined): TipoDeMidia | null {
  if (!mime) return null;
  const limpo = mime.split(';')[0]!.trim().toLowerCase();
  for (const tipo of TIPOS_DE_MIDIA) {
    if (MIMES_POR_TIPO[tipo].includes(limpo)) return tipo;
  }
  return null;
}

/**
 * O caminho do objeto é de acervo? A subpasta é o que distingue o arquivo do
 * escritório de um anexo qualquer de mensagem, dentro do mesmo bucket.
 */
export const SUBPASTA_DO_ACERVO = 'acervo';

/**
 * ⚠️ A rota confere ESTE prefixo antes de gravar a linha.
 *
 * Sem ele, o navegador manda um caminho qualquer no corpo e a linha passa a
 * apontar para o objeto de outra conta — ou para o anexo de uma mensagem, que
 * o compositor apaga quando o envio falha, levando junto o item do acervo.
 */
export function prefixoDoAcervo(accountId: string): string {
  return `account-${accountId}/${SUBPASTA_DO_ACERVO}/`;
}

export function caminhoEhDoAcervo(path: string, accountId: string): boolean {
  return path.startsWith(prefixoDoAcervo(accountId));
}

/** Teto do bucket (16 MB, migration 023). O servidor recusa acima disto. */
export const TETO_DE_BYTES = 16 * 1024 * 1024;

/**
 * A URL da MINIATURA de um item de imagem — nunca o original.
 *
 * ⚠️ O seletor pinta 36×36 e usava `media_url` cru: um acervo com 15 fotos
 * de 4 MB baixava ~60 MB a cada abertura do diálogo, com o operador
 * esperando (ledger da revisão 48h). O Storage do Supabase renderiza sob
 * demanda em `/render/image/public/...` — MEDIDO neste projeto em
 * 2026-08-31 (200 numa imagem real; a transformação está habilitada).
 *
 * ⚠️ Vale SÓ para `tipo === 'image'`. Em PDF o render devolve 400
 * ("source image is invalid or unsupported"), então documento/vídeo/áudio
 * continuam com o ícone do tipo — que é o que a tela já faz.
 *
 * Devolve a URL original quando o caminho não é o esperado: sem
 * `/object/public/` para trocar, um recorte errado renderizaria imagem
 * quebrada, e original pesado é melhor que miniatura ausente.
 */
export const LADO_DA_MINIATURA = 72;

export function urlDaMiniatura(mediaUrl: string, lado = LADO_DA_MINIATURA): string {
  const marca = '/storage/v1/object/public/';
  if (!mediaUrl.includes(marca)) return mediaUrl;
  return `${mediaUrl.replace(marca, '/storage/v1/render/image/public/')}?width=${lado}&height=${lado}&resize=cover`;
}

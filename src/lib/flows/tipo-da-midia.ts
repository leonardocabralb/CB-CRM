// ============================================================
// Nó "Enviar mídia" do robô — os TIPOS de arquivo, e o que cada um vira no
// celular do cliente (CB, 26/09/2026). Puro.
//
// ⚠️ Mora fora de `midia-do-no.ts` de propósito: o validador
// (`validate.ts`) é carregado no NAVEGADOR pelo editor de robôs, e
// `midia-do-no.ts` puxa a cópia do acervo (Storage, service role). Importar o
// tipo de lá arrastava código de Storage para o bundle do editor (revisão do
// robô do previdenciário). Quem precisar só das regras importa daqui.
// ============================================================

import type { SendMediaNodeConfig } from './types';

export type TipoDaMidiaDoNo = SendMediaNodeConfig['media_type'];

export const TIPOS_DA_MIDIA_DO_NO: readonly TipoDaMidiaDoNo[] = [
  'image',
  'video',
  'document',
  'audio',
] as const;

export function ehTipoDaMidiaDoNo(v: unknown): v is TipoDaMidiaDoNo {
  return typeof v === 'string' && (TIPOS_DA_MIDIA_DO_NO as readonly string[]).includes(v);
}

/**
 * Puro: o áudio deste formato aparece como NOTA DE VOZ pelo número OFICIAL
 * (API da Meta)?
 *
 * ⚠️ Só arquivo OGG (Opus) vira nota de voz lá — o próprio remetente da Meta
 * documenta isso (`sendMediaMessage`, `meta-api.ts`). Os outros formatos que
 * o acervo aceita (`audio/mpeg`, `aac`, `mp4`, `amr`) chegam como ARQUIVO de
 * áudio. Pela conexão por QR Code (Evolution) todo áudio sai como nota de voz
 * (`sendWhatsAppAudio` converte), então a pergunta só existe no oficial.
 *
 * `audio/ogg` também pode ser Vorbis, e o mime não diz qual: `true` aqui é
 * "provavelmente", e o teste real no número oficial é quem confirma.
 */
export function audioViraNotaDeVozNaMeta(mime: string | null | undefined): boolean {
  return typeof mime === 'string' && mime.trim().toLowerCase().startsWith('audio/ogg');
}

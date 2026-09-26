// ============================================================
// Nó "Enviar mídia" do robô — QUAL arquivo sai, e como (CB, 26/09/2026).
//
// Pedido do operador para o robô do previdenciário: "configurar uma etapa do
// robô para que envie arquivos em geral já resolveria" — o áudio gravado pelo
// Dr. fica no ACERVO de mídias (953), e o robô o manda como NOTA DE VOZ, pelo
// mesmo caminho do gravador e do acervo do compositor (`engineSendMedia` com
// `kind: 'audio'`: `sendWhatsAppAudio` na Evolution, `type: audio` na Meta).
// ⚠️ Na Meta só arquivo .ogg (Opus) aparece como nota de voz; os outros
// formatos chegam como arquivo de áudio (`audioViraNotaDeVozNaMeta`, e o
// editor avisa).
//
// Duas origens, e o nó antigo continua valendo sem mudança nenhuma:
//   · `acervo_id` — o item do acervo, COPIADO a cada envio (abaixo o porquê);
//   · `media_url` — o upload antigo do construtor (bucket `flow-media`).
//
// ⚠️⚠️ POR QUE COPIAR, se o robô nunca apaga o objeto? A primeira razão da
// cópia do compositor (o envio que falha apaga o arquivo) não vale aqui; a
// SEGUNDA vale igual: o que foi enviado não pode mudar. A mensagem gravada no
// fio aponta para a URL que saiu; referenciando o original, apagar o item do
// acervo (a rota remove o objeto do bucket) deixaria "Áudio indisponível" em
// toda conversa que o robô atendeu. Com a cópia, o histórico fica de pé, e o
// nó ainda falha de forma VISÍVEL (run `failed`, motivo escrito) quando o item
// foi apagado — em vez de mandar à Meta um link morto, que só apareceria
// depois como bolha vermelha.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { copiarDoAcervo } from '@/lib/acervo/copiar';
import { ehTipoDaMidiaDoNo, type TipoDaMidiaDoNo } from './tipo-da-midia';
import type { SendMediaNodeConfig } from './types';

// Os tipos moram em `tipo-da-midia.ts` (puro): o validador roda no navegador
// e não pode puxar este arquivo, que copia no Storage.
export type { TipoDaMidiaDoNo };

/**
 * Puro: de onde vem o arquivo do nó.
 *
 * `acervo_id` VENCE `media_url`: com o item escolhido, a URL guardada é só a
 * da tela. `null` = o nó não tem arquivo (ou o tipo é desconhecido) — o
 * validador já barra isso na ativação; o motor falha visível se chegar aqui.
 */
export function origemDaMidia(
  cfg: Partial<SendMediaNodeConfig> | null | undefined,
):
  | { origem: 'acervo'; acervoId: string }
  | { origem: 'url'; tipo: TipoDaMidiaDoNo; link: string }
  | null {
  if (!cfg) return null;
  const acervoId = typeof cfg.acervo_id === 'string' ? cfg.acervo_id.trim() : '';
  if (acervoId) return { origem: 'acervo', acervoId };
  const link = typeof cfg.media_url === 'string' ? cfg.media_url.trim() : '';
  if (!link || !ehTipoDaMidiaDoNo(cfg.media_type)) return null;
  return { origem: 'url', tipo: cfg.media_type, link };
}

/**
 * Puro: a legenda que viaja. ÁUDIO NUNCA leva (932): a nota de voz não tem
 * campo de legenda, e o texto seria gravado no fio sem ter saído. Vazia (ou
 * só espaço) também não vai.
 */
export function legendaDoEnvio(
  tipo: TipoDaMidiaDoNo,
  legenda: string | null | undefined,
): string | undefined {
  if (tipo === 'audio') return undefined;
  return legenda && legenda.trim() ? legenda : undefined;
}

export interface MidiaPreparada {
  tipo: TipoDaMidiaDoNo;
  link: string;
  filename?: string;
  /** Caminho da CÓPIA no bucket; `null` no nó antigo. Só diagnóstico. */
  copia: string | null;
}

/**
 * I/O: resolve o arquivo que vai sair. Com `acervo_id`, copia o item AGORA
 * (a URL pública da cópia é a que vai para o WhatsApp e para o fio).
 *
 * Lança com motivo legível — quem chama registra no run e o encerra como
 * `failed`, como faz com todo envio que falha.
 */
export async function prepararMidiaDoNo(
  db: SupabaseClient,
  accountId: string,
  cfg: Partial<SendMediaNodeConfig>,
): Promise<MidiaPreparada> {
  const origem = origemDaMidia(cfg);
  if (!origem) throw new Error('send_media node has no file');

  if (origem.origem === 'url') {
    return {
      tipo: origem.tipo,
      link: origem.link,
      filename: cfg.filename || undefined,
      copia: null,
    };
  }

  const copia = await copiarDoAcervo(db, accountId, origem.acervoId);
  if (!copia.ok) {
    if (copia.erro === 'nao_encontrado') {
      throw new Error('the media library item was deleted — pick another file in the robot');
    }
    throw new Error(`media library copy failed (${copia.erro}): ${copia.detalhe}`);
  }
  return {
    // O TIPO vem do item, não do nó: o item não troca de arquivo, e o tipo
    // gravado no nó é só a foto do momento em que foi escolhido.
    tipo: copia.tipo,
    link: copia.mediaUrl,
    // O nome editado no nó (documento) vence; senão o do item.
    filename: cfg.filename || copia.filename,
    copia: copia.path,
  };
}

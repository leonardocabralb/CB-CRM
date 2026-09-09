// ============================================================
// O que o PAYLOAD já diz sobre o anexo, antes de baixar qualquer byte.
//
// Nasceu de um defeito medido em 2026-09-09: sete documentos de cliente
// viraram "Documento indisponível" no fio porque passavam do teto do bucket
// — e o CRM só descobria isso DEPOIS de baixar o arquivo inteiro da
// Evolution (46 MiB, no pior caso) para jogá-lo fora em seguida.
//
// O payload do Baileys declara tamanho e nome. Lidos aqui, antes do
// download, eles respondem "vale a pena baixar?" e "como se chama o que não
// coube?" — e é isso que permite à bolha dizer `Instrumento.pdf` em vez de
// um "Documento indisponível" que não explica nada.
//
// ⚠️ Módulo NEUTRO de propósito: `mediaBytesOf` morava em
// `evolution-group-inbound.ts` e passou a valer também para o 1:1. Deixá-lo
// lá faria o caminho de conversa direta importar do módulo de GRUPO, que é
// exatamente o tipo de vínculo que a bifurcação de 906 existe para evitar.
// ============================================================

import { MEDIA_MAX_BYTES_ENTRADA } from '@/lib/storage/upload-media';

import { unwrapMessage, type EvolutionUpsert } from './evolution-inbound';

/** As quatro caixas de mídia do Baileys, na ordem em que aparecem. */
const CAIXAS_DE_MIDIA = [
  'imageMessage',
  'videoMessage',
  'documentMessage',
  'audioMessage',
] as const;

function caixaDeMidia(
  item: EvolutionUpsert,
): Record<string, unknown> | null {
  const corpo = unwrapMessage(item.message);
  if (!corpo) return null;
  for (const chave of CAIXAS_DE_MIDIA) {
    const m = corpo[chave];
    if (m && typeof m === 'object') return m as Record<string, unknown>;
  }
  return null;
}

/**
 * Bytes declarados do anexo. Vem como STRING no payload da Evolution
 * (conferido na sondagem), então `Number()` é obrigatório — comparar a string
 * com o teto daria resultado errado sem erro nenhum.
 */
export function mediaBytesOf(item: EvolutionUpsert): number | null {
  const m = caixaDeMidia(item);
  if (!m) return null;
  const n = bytesDeclarados(m.fileLength);
  return n !== null && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * O `fileLength` na forma em que cada versão da Evolution o entrega.
 *
 * ⚠️ Na 2.3.2 chegava como STRING (`'43407'`, medido nas amostras de
 * 09/09/2026); na 2.4 (Baileys 7) chega como o objeto `Long` do protobuf,
 * `{ low, high, unsigned }` — medido no primeiro anexo depois do upgrade
 * (`fileLength: { low: 59064, high: 0, unsigned: true }`). `Number({...})` é
 * NaN, e a versão anterior devolvia `null`: "tamanho desconhecido, tenta
 * baixar" — inofensivo para o anexo pequeno, mas o portão por tamanho da
 * 986 ficava cego, e um documento de 60 MiB era baixado inteiro (em base64)
 * para ser recusado depois. Ver docs/PLANO-baileys-7.md, ajuste 4.
 */
export function bytesDeclarados(v: unknown): number | null {
  if (v && typeof v === 'object' && 'low' in v) {
    const { low, high } = v as { low?: unknown; high?: unknown };
    const lo = Number(low);
    const hi = Number(high ?? 0);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    // `low`/`high` são os 32 bits de baixo e de cima, como inteiros COM sinal
    // — `>>> 0` os lê sem sinal antes de compor.
    return (hi >>> 0) * 2 ** 32 + (lo >>> 0);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * O nome do arquivo como o remetente enviou, direto do payload — sem
 * depender do download.
 *
 * ⚠️ Só documento tem nome. Foto, vídeo e nota de voz chegam sem `fileName`,
 * e inventar um aqui encheria a bolha de `media.jpg` (é o fallback que
 * `evolution-media.ts` usa só para nomear o OBJETO no bucket, nunca para
 * mostrar — ver a cascata de `mediaFilename`, 969).
 */
export function nomeDeArquivoDeclarado(item: EvolutionUpsert): string | null {
  const m = caixaDeMidia(item);
  const nome = m?.fileName;
  return typeof nome === 'string' && nome.trim() ? nome : null;
}

/**
 * Este anexo passa do que o Storage aceita?
 *
 * ⚠️ Tamanho DESCONHECIDO responde `false` — a mesma escolha que o
 * agendamento do download de grupo já fazia: na dúvida, tenta. O teto de
 * verdade continua sendo conferido em `fetchAndStoreEvolutionMedia`, depois
 * do download, para o payload que não declara `fileLength`.
 */
export function anexoGrandeDemais(bytes: number | null | undefined): boolean {
  return bytes != null && bytes > MEDIA_MAX_BYTES_ENTRADA;
}

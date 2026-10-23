// ============================================================
// O servidor da Lixeira de contatos (1097): o VENCIMENTO dos 90 dias e a
// DRENAGEM da fila de arquivos a apagar do `chat-media`.
//
// Os dois rodam no ciclo das agendadas (`/api/cb/scheduled/cron`, laço de
// 15 min), em `after()`, sob o prazo comum de `manutencao-do-ciclo.ts` — rota
// de cron própria só rodaria depois de mudar o `command` do agendador E de um
// `docker stack deploy` manual na VPS (o motivo que já pôs ali as tarefas
// recorrentes).
//
// Quem decide é o BANCO: `cb_vencer_lixeira` exclui de vez UM item vencido
// por chamada (põe os arquivos dele na fila e grava `contact_purged`);
// `cb_reivindicar_arquivos_a_apagar` carimba um lote (a tentativa já conta
// ali) e devolve só o que pode sair — caminho fora da guarda ou ainda citado
// por alguém sai da fila sem apagar o arquivo. Aqui fica o que o banco não
// alcança: o `storage.remove` e o que fazer com a resposta dele.
//
// ⚠️⚠️ CERCA DE POSSE (raiz, 8e): toda escrita na fila depois da
// reivindicação leva `reivindicado_em = <carimbo do próprio lote>`. Um lote
// que demorou mais que os 10 min do recolhimento pode ter sido reivindicado
// de novo por outro ciclo; sem a cerca, este apagaria (ou anotaria) a linha
// que agora é do outro.
//
// ⚠️ A guarda do caminho é conferida DE NOVO pelo espelho TS
// (`caminhoNoChatMedia`) antes do `remove`: um defeito na fila nunca apaga
// arquivo de outra conta nem do acervo. O que o espelho recusa fica no
// bucket e ganha `ultimo_erro` (as tentativas se esgotam e a tela da Lixeira
// conta como "parado") — os dois lados divergiram, e isso tem de aparecer.
//
// ⚠️ NUNCA LANÇA: roda depois da resposta, e um erro aqui não pode virar
// rejeição solta no processo. O supabase-js DEVOLVE `error` (conferido em
// toda chamada); o Storage pode também LANÇAR (rede), daí o try/catch.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { lerExclusaoDefinitiva } from '@/lib/contacts/lixeira';

import { CHAT_MEDIA_BUCKET } from './buckets';
import { caminhoNoChatMedia } from './caminho-no-chat-media';

/** Arquivos por reivindicação: o padrão da função (o teto dela é 100). */
export const ARQUIVOS_POR_LOTE = 25;

/**
 * Teto do texto gravado em `ultimo_erro`. A mensagem vem do Storage do
 * PRÓPRIO projeto: a chave de serviço viaja no cabeçalho e não volta no
 * corpo do erro (nenhum `semSegredo` do projeto se aplica — todos tiram o
 * token de um provedor externo). O corte só evita corpo grande na tabela.
 */
const TETO_DO_ERRO = 300;

const TAG = '[lixeira]';

function motivo(err: unknown): string {
  return err instanceof Error ? err.message : 'erro desconhecido';
}

// ── O vencimento ─────────────────────────────────────────────────────────

export interface ResultadoDoVencimento {
  /** Itens excluídos de vez neste ciclo. */
  excluidas: number;
  /** Arquivos que esses itens puseram na fila (saem na drenagem). */
  arquivos: number;
  /** Motivo, quando o vencimento parou no meio. */
  erro: string | null;
}

/**
 * Exclui de vez os itens com o prazo vencido, UM por chamada, até não haver
 * vencido ou estourar o `prazo` (instante, em ms). O que sobrar sai no ciclo
 * seguinte.
 */
export async function vencerLixeira(
  admin: SupabaseClient,
  prazo: number
): Promise<ResultadoDoVencimento> {
  let excluidas = 0;
  let arquivos = 0;
  try {
    while (Date.now() < prazo) {
      const { data, error } = await admin.rpc('cb_vencer_lixeira');
      if (error) throw new Error(error.message);
      // NULL = nada vencido (ou o que venceu está travado por quem restaura).
      if (data == null) break;

      const item = lerExclusaoDefinitiva({ itens: [data] })?.[0];
      // Forma inesperada, ou um item que não saiu: PARA. Repetir a chamada
      // giraria em falso sobre o mesmo item até o prazo.
      if (!item || item.resultado !== 'excluida') {
        throw new Error(
          `o vencimento devolveu ${JSON.stringify(data).slice(0, TETO_DO_ERRO)}`
        );
      }
      excluidas += 1;
      arquivos += item.arquivos;
    }
    if (excluidas > 0) {
      console.log(
        `${TAG} vencimento: ${excluidas} ficha(s) excluída(s) de vez, ${arquivos} arquivo(s) na fila`
      );
    }
    return { excluidas, arquivos, erro: null };
  } catch (err) {
    console.error(`${TAG} vencimento falhou:`, motivo(err));
    return { excluidas, arquivos, erro: motivo(err) };
  }
}

// ── A drenagem da fila ───────────────────────────────────────────────────

interface Reivindicado {
  id: string;
  accountId: string;
  bucket: string;
  caminho: string;
  /** `reivindicado_em` deste lote, como o banco o devolveu: é a cerca. */
  carimbo: string;
}

/** As linhas da reivindicação; a que não tem a forma esperada fica de fora. */
function lerReivindicados(bruto: unknown): {
  linhas: Reivindicado[];
  tortas: number;
} {
  const linhas: Reivindicado[] = [];
  let tortas = 0;
  for (const item of Array.isArray(bruto) ? bruto : []) {
    const o =
      item && typeof item === 'object'
        ? (item as Record<string, unknown>)
        : null;
    const campos = o
      ? [o.id, o.account_id, o.bucket, o.caminho, o.carimbo]
      : [];
    if (!o || !campos.every((c) => typeof c === 'string' && c !== '')) {
      tortas += 1;
      continue;
    }
    linhas.push({
      id: o.id as string,
      accountId: o.account_id as string,
      bucket: o.bucket as string,
      caminho: o.caminho as string,
      carimbo: o.carimbo as string,
    });
  }
  return { linhas, tortas };
}

/** As linhas agrupadas pela cerca (um lote tem um carimbo só; o agrupamento não supõe isso). */
function porCarimbo(linhas: readonly Reivindicado[]): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const l of linhas)
    grupos.set(l.carimbo, [...(grupos.get(l.carimbo) ?? []), l.id]);
  return grupos;
}

/** Tira da fila o que saiu do bucket — cercado pelo carimbo. */
async function tirarDaFila(
  admin: SupabaseClient,
  linhas: readonly Reivindicado[]
): Promise<void> {
  for (const [carimbo, ids] of porCarimbo(linhas)) {
    const { error } = await admin
      .from('cb_arquivos_a_apagar')
      .delete()
      .in('id', ids)
      .eq('reivindicado_em', carimbo);
    // O arquivo já saiu: a linha que ficou é reivindicada de novo depois dos
    // 10 min, o `remove` de um objeto que não existe passa, e ela sai então.
    if (error)
      console.error(
        `${TAG} a fila não largou ${ids.length} linha(s):`,
        error.message
      );
  }
}

/** Anota por que o lote não saiu — cercado pelo carimbo. */
async function anotarErro(
  admin: SupabaseClient,
  linhas: readonly Reivindicado[],
  texto: string
): Promise<void> {
  for (const [carimbo, ids] of porCarimbo(linhas)) {
    const { error } = await admin
      .from('cb_arquivos_a_apagar')
      .update({ ultimo_erro: texto.slice(0, TETO_DO_ERRO) })
      .in('id', ids)
      .eq('reivindicado_em', carimbo);
    if (error)
      console.error(
        `${TAG} o motivo não gravou em ${ids.length} linha(s):`,
        error.message
      );
  }
}

export interface ResultadoDaDrenagem {
  /** Caminhos removidos do bucket neste ciclo. */
  apagados: number;
  /** Caminhos que o espelho TS recusou: ficaram no bucket, com o motivo. */
  foraDaGuarda: number;
  /** Caminhos do lote que o Storage recusou: voltam no ciclo seguinte. */
  falhas: number;
  /** Motivo, quando a drenagem parou no meio. */
  erro: string | null;
}

/**
 * Drena a fila até ela esvaziar ou estourar o `prazo` (instante, em ms):
 * reivindica um lote, confere cada caminho pelo espelho, remove o lote do
 * bucket numa chamada e tira as linhas da fila. Erro do Storage anota o
 * motivo e PARA este ciclo: costuma ser o Storage inteiro fora, e seguir
 * queimaria as tentativas da fila toda de uma vez.
 */
export async function drenarArquivosAApagar(
  admin: SupabaseClient,
  prazo: number
): Promise<ResultadoDaDrenagem> {
  const r: ResultadoDaDrenagem = {
    apagados: 0,
    foraDaGuarda: 0,
    falhas: 0,
    erro: null,
  };
  try {
    while (Date.now() < prazo) {
      const { data, error } = await admin.rpc(
        'cb_reivindicar_arquivos_a_apagar',
        {
          p_limite: ARQUIVOS_POR_LOTE,
        }
      );
      if (error) throw new Error(error.message);
      const { linhas, tortas } = lerReivindicados(data);
      if (tortas > 0)
        console.error(
          `${TAG} ${tortas} linha(s) da fila com forma inesperada; ficaram`
        );
      if (linhas.length === 0) break;

      const validas: Reivindicado[] = [];
      const fora: Reivindicado[] = [];
      for (const l of linhas) {
        const ok =
          l.bucket === CHAT_MEDIA_BUCKET &&
          caminhoNoChatMedia(l.caminho, l.accountId) === l.caminho;
        (ok ? validas : fora).push(l);
      }
      if (fora.length > 0) {
        r.foraDaGuarda += fora.length;
        console.error(
          `${TAG} ${fora.length} caminho(s) fora da guarda do espelho TS; ficaram no bucket`
        );
        await anotarErro(
          admin,
          fora,
          'fora da guarda (espelho TS de cb_caminho_no_chat_media)'
        );
      }
      if (validas.length === 0) continue;

      let erroDoStorage: string | null = null;
      try {
        const { error: erroRemove } = await admin.storage
          .from(CHAT_MEDIA_BUCKET)
          .remove(validas.map((l) => l.caminho));
        if (erroRemove)
          erroDoStorage = erroRemove.message || 'o Storage recusou';
      } catch (err) {
        erroDoStorage = motivo(err);
      }

      if (erroDoStorage !== null) {
        r.falhas += validas.length;
        await anotarErro(admin, validas, erroDoStorage);
        throw new Error(`o Storage recusou o lote: ${erroDoStorage}`);
      }

      r.apagados += validas.length;
      await tirarDaFila(admin, validas);
    }
    if (r.apagados > 0 || r.foraDaGuarda > 0) {
      console.log(
        `${TAG} drenagem: ${r.apagados} arquivo(s) apagado(s), ${r.foraDaGuarda} fora da guarda`
      );
    }
    return r;
  } catch (err) {
    console.error(`${TAG} drenagem parou:`, motivo(err));
    return { ...r, erro: motivo(err) };
  }
}

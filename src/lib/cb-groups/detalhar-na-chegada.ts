// ============================================================
// Grupo que chega SEM DETALHE se detalha sozinho.
//
// O grupo nasce pela primeira mensagem (`findOrCreateGroup`) só com o jid: a
// mensagem não traz nome, participantes nem quem é admin. Até aqui isso só
// vinha do botão "Sincronizar dados do grupo", e um grupo novo ficava como
// "Grupo sem nome", com o renomear travado, até alguém lembrar de clicar —
// medido em 29/10/2026: um grupo de 27/10 numa conexão sincronizada pela
// última vez em 01/09. Desde a 1117, também o grupo cuja lista não é
// conferida contra as fichas há mais de 24 h: é o que mantém o grupo na ficha
// de quem está nele (`fichas-do-grupo.ts`).
//
// A rota do webhook da Evolution chama isto DEPOIS de gravar todos os itens do
// lote (e os anexos): o `findGroupInfos` custa ~0,8 s, e dentro do laço
// atrasaria — e, num corte do `after()`, perderia — as mensagens seguintes.
//
// Só quem chama a Evolution é este módulo; `persist.ts` continua sem
// transporte e sem motor.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { getChannelWithSecrets } from '@/lib/cb-channels/repo';
import { ehEvolution } from '@/lib/cb-channels/transporte';
import { detalharGrupos } from '@/lib/cb-groups/sync';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { decrypt } from '@/lib/whatsapp/encryption';

/**
 * Um grupo não é tentado de novo antes disto. Sem o freio, uma Evolution que
 * falha no `findGroupInfos` levaria uma chamada a CADA mensagem do grupo — e
 * grupo movimentado manda dezenas por hora.
 */
export const ESPERA_ENTRE_TENTATIVAS_MS = 15 * 60_000;

/**
 * Última tentativa por grupo (`<conta>:<jid>`), neste processo. Reiniciar o
 * contêiner zera o freio: no pior caso, uma tentativa a mais por grupo.
 */
const tentativas = new Map<string, number>();

/**
 * Detalha os grupos desta entrega que chegaram sem detalhe ou com a lista
 * conferida há mais de 24 h (1117: o detalhamento refaz o vínculo com as
 * fichas). Todos são da
 * conexão `channelId` (quem chama só junta os de `grupoParaDetalhar`, que
 * exige isso). Nunca lança: o detalhe é acessório, a mensagem já está gravada.
 */
export async function detalharGruposDaChegada(args: {
  db: SupabaseClient;
  accountId: string;
  channelId: string;
  jids: string[];
  agora: number;
}): Promise<void> {
  // ⚠️ Carimba a tentativa ANTES de chamar: a entrega seguinte do mesmo grupo
  // pode chegar enquanto esta ainda espera a Evolution.
  const jids = args.jids.filter((jid) => {
    const chave = `${args.accountId}:${jid}`;
    const ultima = tentativas.get(chave);
    if (ultima != null && args.agora - ultima < ESPERA_ENTRE_TENTATIVAS_MS) return false;
    tentativas.set(chave, args.agora);
    return true;
  });
  if (!jids.length) return;

  try {
    const canal = await getChannelWithSecrets(args.db, args.accountId, args.channelId);
    if (!canal || !ehEvolution(canal)) return;
    if (!canal.server_url || !canal.instance_name || !canal.api_key) return;

    const client = new EvolutionClient({
      baseUrl: canal.server_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });
    // O telefone do canal é o que acha a NOSSA linha entre os participantes
    // ("somos admin?", o nosso LID) — sem ele os dois ficariam nulos.
    await detalharGrupos(args.db, {
      accountId: args.accountId,
      channelId: args.channelId,
      client,
      displayPhone: canal.display_phone ?? null,
      jids,
      ownLidConhecido: (canal as { own_lid?: string | null }).own_lid ?? null,
    });
  } catch (err) {
    console.error(
      '[cb-groups] detalhar grupo na chegada falhou:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ============================================================
// Envios sem recibo — o quarto motivo âmbar da saúde das conexões.
//
// O atraso de entrega (`atraso-de-entrega.ts`, 1002) só mede quando CHEGA
// mensagem. A conexão que para de receber de vez apaga o próprio alarme: a
// medição vale 1 h e envelhece. Foi o que aconteceu de 02 a 04/11/2026 numa
// conexão da instalação de referência. Ela caía a cada 50 min (o stanza
// `<status>` sem ack, `docs/INFRA-VPS.md` §8), nada chegou no dia útil
// inteiro de 03/11, e o âmbar ficou apagado das 03:52 às 20:52. Enquanto
// isso, a equipe mandou 90 mensagens e nenhuma ganhou o ✓✓. As mensagens
// tinham chegado aos clientes; o recibo é que estava preso na mesma fila da
// entrada.
//
// A pergunta daqui é outra: "esta conexão envia e nada volta?". Ela não
// depende de o cliente escrever, só de a equipe ou o robô enviarem. Vale
// para a fila de entrada parada e para o webhook que não chega (o recibo vem
// pelo mesmo webhook que a mensagem do cliente), na Evolution e na Meta.
//
// A régua (decisão do operador, 04/11/2026, `docs/PLANO-alarmes-de-conexao.md`):
// os 5 envios mais recentes com mais de 15 min, das últimas 3 h, em pelo
// menos 3 conversas, sem nenhum recibo de entrega ou de leitura. E apaga no
// 1º recibo: um envio confirmado, mesmo novo, encerra a sequência.
//
// MEDIDO antes de escolher (04/11/2026, só leitura):
//  · de 17/09 a 02/11, a maior sequência de envios do CRM que NUNCA tiveram
//    recibo foi de 4 envios, em no máximo 2 conversas;
//  · numa hora normal, 83 de 85 envios das conexões sadias tiveram recibo em
//    até 5 min (mediana ~1 s); na conexão travada, 0 de 20 em 1 h.
//
// ⚠️ FICAM DE FORA, de propósito:
//  · o Instagram: o Direct não manda recibo de entrega, e o aviso de leitura
//    o CRM não grava (`instagram/persistir.ts`) — todo envio fica em `sent`;
//  · o grupo: o ✓✓ só vem quando TODOS os participantes de fora receberam
//    (`cb-groups/recibos-do-grupo.ts`, 1119), e sem o 5º patch da imagem da
//    Evolution nem vem. Um participante com o celular desligado o segura, então
//    ele não mede a conexão;
//  · o envio pelo CELULAR (`from_device`): ele chega ao CRM pela mesma fila
//    parada, e no incidente nenhum chegou;
//  · o envio que falhou (`failed`) e a tentativa que não saiu (`nao_saiu`):
//    não saíram, então não há recibo a esperar.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Envio mais novo que isto ainda pode estar a caminho: não acusa nada. */
export const IDADE_MINIMA_DO_ENVIO_MS = 15 * 60_000;

/** Só os envios desta janela contam para ACENDER. */
export const JANELA_DOS_ENVIOS_MS = 3 * 60 * 60_000;

export const ENVIOS_SEM_RECIBO_MINIMOS = 5;

/** As 3 conversas protegem contra a rajada para um cliente só, com o celular desligado. */
export const CONVERSAS_SEM_RECIBO_MINIMAS = 3;

/**
 * Quanto a leitura olha para trás. Mais que a janela de propósito: o `desde`
 * da frase ("não confirma entrega desde 09:10") é o começo da sequência sem
 * recibo, que pode ser mais velho que as 3 h que acendem.
 */
export const JANELA_DA_LEITURA_MS = 24 * 60 * 60_000;

/**
 * Teto da leitura dos envios MADUROS (com mais de 15 min) por conexão. A
 * régua só olha os 5 mais recentes; o teto limita o `desde`: no incidente
 * foram ~90 envios num dia, e numa sequência mais longa o `desde` sai mais
 * novo que o real (nunca mais velho).
 */
export const ENVIOS_LIDOS_POR_CONEXAO = 100;

export interface EnvioRecente {
  /** `messages.created_at` do envio (ISO). */
  criadoEm: string;
  status: string;
  conversaId: string;
}

export interface SemRecibo {
  /** O envio mais velho da sequência sem recibo, dentro da leitura (ISO). */
  desdeIso: string;
}

/** O WhatsApp confirmou? `sent` é o aceite do provedor, não do aparelho. */
export function envioConfirmado(status: string): boolean {
  return status === 'delivered' || status === 'read';
}

/**
 * A conexão envia e nada volta? `null` quando não há como afirmar isso: a
 * conexão confirma, ou há envio de menos para dizer.
 *
 * Os envios chegam em qualquer ordem; a função ordena pelo `criadoEm`.
 */
export function semRecibo(envios: readonly EnvioRecente[], agoraMs: number): SemRecibo | null {
  const ordenados = envios
    .map((e) => ({ ...e, ms: Date.parse(e.criadoEm) }))
    .filter((e) => Number.isFinite(e.ms))
    .sort((a, b) => b.ms - a.ms);

  // A sequência sem recibo: do mais novo para trás, até o 1º confirmado.
  // Inclui os envios novos (menos de 15 min): um deles confirmado já prova
  // que a volta funciona, e a sequência nem começa.
  const pendentes: typeof ordenados = [];
  for (const e of ordenados) {
    if (envioConfirmado(e.status)) break;
    pendentes.push(e);
  }

  const maduros = pendentes.filter(
    (e) => agoraMs - e.ms >= IDADE_MINIMA_DO_ENVIO_MS && agoraMs - e.ms <= JANELA_DOS_ENVIOS_MS,
  );
  if (maduros.length < ENVIOS_SEM_RECIBO_MINIMOS) return null;

  const conversas = new Set(maduros.slice(0, ENVIOS_SEM_RECIBO_MINIMOS).map((e) => e.conversaId));
  if (conversas.size < CONVERSAS_SEM_RECIBO_MINIMAS) return null;

  return { desdeIso: new Date(pendentes[pendentes.length - 1].ms).toISOString() };
}

interface LinhaDoEnvio {
  created_at: string;
  status: string | null;
  conversation_id: string;
}

/**
 * Os envios do CRM desta conexão que a régua precisa, do mais novo para trás.
 * `null` = a leitura falhou: "não sei", que nunca acusa.
 *
 * São DUAS leituras, e o teto vale só na segunda (Codex, PR #458):
 *  1. o envio CONFIRMADO mais novo dos últimos 15 min, se houver — sozinho
 *     ele já encerra a sequência ("apaga no 1º recibo");
 *  2. os envios MADUROS (24 h, com mais de 15 min), com teto de 100.
 * Numa leitura só, uma rajada de envios recentes ou de envios a grupo
 * ocupava o teto, os maduros de 1:1 ficavam de fora, e o alarme deixava de
 * acender — ou apagava com os recibos ainda parados. O envio recente sem
 * recibo não muda a resposta (não é maduro nem confirmado), então nem é lido.
 *
 * ⚠️ E uma TERCEIRA, só com um episódio aberto há mais de 24 h
 * (`desdeDoEpisodioIso`): o envio confirmado mais novo entre o começo dele e
 * a janela das 24 h. É a PROVA do fim que a janela não vê — o episódio da
 * sexta, cujos envios ganham o recibo na segunda sem envio novo, ficava
 * "sem prova" e repetia o "Continua" a cada 24 h. Ela não muda a régua (o
 * envio de mais de 24 h está fora das 3 h e não é o último confirmado).
 *
 * ⚠️ O grupo sai NA CONSULTA: `conversations!inner` com `contact_id` não
 * nulo (conversa de grupo não tem contato), o mesmo embutido com filtro que
 * o webhook da Evolution usa (`conversations.account_id`). Com o embutido
 * LEFT e o filtro em JS, o grupo ocupava o teto.
 *
 * O índice `messages_canal_e_data_idx` (1120) serve as três: sem ele, a busca
 * varre todas as mensagens da conexão (973 ms medidos).
 */
export async function lerEnviosRecentes(
  db: SupabaseClient,
  channelId: string,
  agoraMs: number,
  desdeDoEpisodioIso: string | null = null,
): Promise<EnvioRecente[] | null> {
  const corteDoMaduro = new Date(agoraMs - IDADE_MINIMA_DO_ENVIO_MS).toISOString();
  const inicioDaJanela = new Date(agoraMs - JANELA_DA_LEITURA_MS).toISOString();
  const envios = () =>
    db
      .from('messages')
      .select('created_at, status, conversation_id, conversations!inner(contact_id)')
      .eq('channel_id', channelId)
      .in('sender_type', ['agent', 'bot'])
      .eq('from_device', false)
      .eq('nao_saiu', false)
      .neq('status', 'failed')
      .not('conversations.contact_id', 'is', null);
  const provaAntiga = () =>
    desdeDoEpisodioIso !== null && Date.parse(desdeDoEpisodioIso) < Date.parse(inicioDaJanela)
      ? envios()
          .gte('created_at', desdeDoEpisodioIso)
          .lt('created_at', inicioDaJanela)
          .in('status', ['delivered', 'read'])
          .order('created_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null });
  try {
    const [novo, maduros, antiga] = await Promise.all([
      envios()
        .gte('created_at', corteDoMaduro)
        .in('status', ['delivered', 'read'])
        .order('created_at', { ascending: false })
        .limit(1),
      envios()
        .gte('created_at', inicioDaJanela)
        .lt('created_at', corteDoMaduro)
        .order('created_at', { ascending: false })
        .limit(ENVIOS_LIDOS_POR_CONEXAO),
      provaAntiga(),
    ]);
    const falha = novo.error ?? maduros.error ?? antiga.error;
    if (falha) {
      console.warn('[sem-recibo] não leu os envios:', falha.message);
      return null;
    }
    const linhas = [
      ...(novo.data ?? []),
      ...(maduros.data ?? []),
      ...(antiga.data ?? []),
    ] as unknown as LinhaDoEnvio[];
    return linhas.map((linha) => ({
      criadoEm: linha.created_at,
      status: linha.status ?? '',
      conversaId: linha.conversation_id,
    }));
  } catch (err) {
    console.warn('[sem-recibo] não leu os envios:', err instanceof Error ? err.message : err);
    return null;
  }
}

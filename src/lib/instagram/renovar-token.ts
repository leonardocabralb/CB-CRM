// ============================================================
// Fase 6 do Instagram Direct: o token da conexão não pode morrer sozinho.
//
// O token longo do login do Instagram vale 60 dias e só se renova enquanto
// VALE (doc de 21/11/2026: "tokens que não foram renovados em 60 dias
// vencem e não podem mais ser renovados"). Vencido, a conexão fica muda — a
// resposta da equipe é recusada — até alguém reconectar a conta.
//
// Roda no ciclo das agendadas (`rodarManutencaoDoCiclo`, laço de 15 min), não
// numa rota nova: rota nova só entra no agendador com `docker stack deploy`
// manual na VPS (decisão do operador, 21/11/2026).
//
// A régua:
//   · renova o token renovado há 7 dias ou mais (a Meta exige 24 h de idade);
//     a conexão vencida fica de fora — não há o que renovar;
//   · o vencimento novo vem do `expires_in` MEDIDO e tem de passar do antigo:
//     200 com o mesmo prazo não é renovação (fica para o próximo ciclo);
//   · só o token RECUSADO (190) marca a conexão como desconectada, com o
//     motivo. Rede, limite e erro da Meta tentam de novo no ciclo seguinte;
//   · as DUAS escritas (o token novo e a marca de desconectada) são CERCADAS
//     pelo carimbo lido: reconectar a conta no meio grava um token novo, e a
//     resposta atrasada sobre o velho não o sobrescreve nem o desconecta.
//
// O host e a forma do pedido moram em `graph.ts` (`renovarTokenLongo`).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

import { InstagramApiError, renovarTokenLongo } from './graph';

export const RENOVAR_A_CADA_DIAS = 7;
const DIA_MS = 86_400_000;

/** O token recusado: a conexão precisa ser reconectada por alguém. */
export const MOTIVO_TOKEN_RECUSADO =
  'O token do Instagram venceu ou foi revogado: reconecte a conta em Configurações → Conexões.';

export interface ResultadoDaRenovacao {
  renovados: number;
  /** Tentativas que não renovaram (ficam para o próximo ciclo). */
  falhas: number;
  /** Conexões marcadas como desconectadas (token recusado). */
  desconectadas: number;
  erro: string | null;
}

interface LinhaDoCanal {
  id: string;
  access_token: string | null;
  ig_token_expires_at: string | null;
  ig_token_refreshed_at: string | null;
}

/**
 * Quanto um pedido de renovação pode levar (o prazo do cliente em `graph.ts`).
 * Só se COMEÇA um pedido com isso sobrando no prazo comum da manutenção.
 */
export const DURACAO_MAXIMA_DO_PEDIDO_MS = 10_000;

/**
 * NUNCA lança. `agora` e `renovar` são injetáveis no teste.
 *
 * ⚠️ `prazo` é o prazo COMUM da manutenção do ciclo (`manutencao-do-ciclo.ts`,
 * epoch ms): com a Meta lenta, 100 conexões × 10 s gastariam o orçamento
 * inteiro, e os passos seguintes (Lixeira, podas, transcrições) receberiam o
 * prazo já vencido (Codex, PR #539). Sem pedido novo quando ele não cabe; o
 * resto renova no próximo ciclo.
 */
export async function renovarTokensDoInstagram(
  admin: SupabaseClient,
  agora: Date = new Date(),
  renovar: typeof renovarTokenLongo = renovarTokenLongo,
  prazo: number = Number.POSITIVE_INFINITY,
  relogio: () => number = Date.now
): Promise<ResultadoDaRenovacao> {
  const resultado: ResultadoDaRenovacao = {
    renovados: 0,
    falhas: 0,
    desconectadas: 0,
    erro: null,
  };
  const limite = new Date(
    agora.getTime() - RENOVAR_A_CADA_DIAS * DIA_MS
  ).toISOString();
  const agoraIso = agora.toISOString();

  const { data, error } = await admin
    .from('cb_channels')
    .select('id, access_token, ig_token_expires_at, ig_token_refreshed_at')
    .eq('kind', 'instagram')
    .eq('status', 'connected')
    .not('access_token', 'is', null)
    .or(`ig_token_refreshed_at.is.null,ig_token_refreshed_at.lt.${limite}`)
    // ⚠️ O vencido sai NO BANCO, antes do limite (Codex, PR #539): pulado só
    // no laço, ele não muda nada na linha e voltaria em todo ciclo — 100
    // vencidos ocupariam o lote e os válidos nunca seriam renovados. Dois
    // `.or()` na mesma consulta já rodam em produção (`atraso-de-entrega.ts`).
    .or(`ig_token_expires_at.is.null,ig_token_expires_at.gt.${agoraIso}`)
    // O que vence primeiro vai primeiro: o prazo do ciclo pode cortar o resto.
    .order('ig_token_expires_at', { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) {
    console.error(
      '[instagram/token] leitura das conexões falhou:',
      error.message
    );
    return { ...resultado, erro: error.message };
  }

  for (const canal of (data ?? []) as LinhaDoCanal[]) {
    if (relogio() + DURACAO_MAXIMA_DO_PEDIDO_MS > prazo) {
      console.warn('[instagram/token] o prazo da manutenção acabou: o resto renova no próximo ciclo');
      break;
    }
    if (!canal.access_token) continue;
    // Vencido não se renova (a Meta recusa): fica para quem reconectar.
    if (
      canal.ig_token_expires_at &&
      new Date(canal.ig_token_expires_at).getTime() <= agora.getTime()
    ) {
      continue;
    }
    let tokenAtual: string;
    try {
      tokenAtual = decrypt(canal.access_token);
    } catch {
      console.error(`[instagram/token] ${canal.id}: token não decifra`);
      resultado.falhas++;
      continue;
    }

    try {
      const novo = await renovar(tokenAtual);
      const vence = new Date(agora.getTime() + novo.expiraEmSeg * 1000);
      const antigo = canal.ig_token_expires_at
        ? new Date(canal.ig_token_expires_at).getTime()
        : 0;
      if (vence.getTime() <= antigo) {
        // A Meta respondeu 200 sem estender o prazo: não é renovação.
        console.warn(
          `[instagram/token] ${canal.id}: a Meta não estendeu o prazo`
        );
        resultado.falhas++;
        continue;
      }
      let gravacao = admin
        .from('cb_channels')
        .update({
          access_token: encrypt(novo.token),
          ig_token_expires_at: vence.toISOString(),
          ig_token_refreshed_at: agoraIso,
          updated_at: agoraIso,
        })
        .eq('id', canal.id)
        .eq('kind', 'instagram');
      gravacao = canal.ig_token_refreshed_at
        ? gravacao.eq('ig_token_refreshed_at', canal.ig_token_refreshed_at)
        : gravacao.is('ig_token_refreshed_at', null);
      const { data: gravadas, error: erroGravar } = await gravacao.select('id');
      if (erroGravar) {
        // ⚠️ A Meta pode já ter trocado o token: o antigo ainda vale até
        // vencer (a doc não diz que a renovação o invalida), e o próximo ciclo
        // renova de novo. Sem o log, o token novo se perderia em silêncio.
        console.error(
          `[instagram/token] ${canal.id}: gravar o token novo falhou:`,
          erroGravar.message
        );
        resultado.falhas++;
        continue;
      }
      // Zero linhas = alguém reconectou a conta no meio: o token dela vale.
      if ((gravadas ?? []).length > 0) resultado.renovados++;
    } catch (err) {
      resultado.falhas++;
      if (err instanceof InstagramApiError && err.codigo === 'token_invalido') {
        // ⚠️ A MESMA cerca da renovação (Codex, PR #539): reconectar a conta
        // enquanto este pedido estava no ar grava um token novo e avança o
        // carimbo; o 190 que chega atrasado é do token VELHO, e sem a cerca
        // marcaria desconectada a conexão que acabou de voltar — e ela sairia
        // das renovações seguintes.
        let marca = admin
          .from('cb_channels')
          .update({
            status: 'disconnected',
            last_error: MOTIVO_TOKEN_RECUSADO,
            updated_at: agoraIso,
          })
          .eq('id', canal.id)
          .eq('kind', 'instagram');
        marca = canal.ig_token_refreshed_at
          ? marca.eq('ig_token_refreshed_at', canal.ig_token_refreshed_at)
          : marca.is('ig_token_refreshed_at', null);
        const { data: marcadas, error: erroMarca } = await marca.select('id');
        if (erroMarca) {
          console.error(
            `[instagram/token] ${canal.id}: marcar desconectada falhou:`,
            erroMarca.message
          );
        } else if ((marcadas ?? []).length > 0) {
          resultado.desconectadas++;
        }
      }
      console.error(
        `[instagram/token] ${canal.id}: renovação falhou:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  return resultado;
}

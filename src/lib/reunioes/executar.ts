import type { SupabaseClient } from '@supabase/supabase-js';

import { avisarDrenagemDeFunil } from '@/lib/automations/avisar-drenagem';

import type { Acao, AlvoDaAcao, ReuniaoDaPauta } from './pauta';

export type DesfechoDaAcao = 'ok' | 'card_mudou' | 'falhou' | 'registro_falhou';

/**
 * Executa um botão da pauta: move o card e registra a marcação.
 *
 * ⚠️ A mudança de etapa vai do NAVEGADOR, sob RLS, como o arrasto do quadro e
 * o painel da conversa: é o que faz a trilha (912) e as automações e avisos de
 * funil (933/1040) verem GENTE (`auth.uid()`). Por uma rota com service role a
 * mesma escrita sairia "sistema" na trilha e `source: system` nos webhooks.
 *
 * ⚠️ Valor e etapa vão NA MESMA escrita: o Make da iMotion ouve a entrada em
 * Proposta Realizada e manda à TinTim o valor do card NAQUELE instante — em
 * duas escritas, a TinTim receberia R$ 0.
 *
 * ⚠️ A escrita é CERCADA pela etapa em que a tela viu o card
 * (`.eq('stage_id', …)`): entre carregar a pauta e clicar, uma automação (o
 * Calendly move para "Reunião Agendada") ou um colega pode ter movido o card,
 * e passar por cima levaria o card para trás. Zero linhas = `card_mudou`: a
 * tela recarrega e a pessoa decide de novo.
 *
 * O card primeiro, o registro depois. Se o registro falhar com o card já
 * movido, a trilha ainda resolve a reunião (a tela lê as duas fontes) — o
 * único caso que ficaria aberto é o card que já estava na etapa, e aí a tela
 * avisa (`registro_falhou`).
 */
export async function executarAcao(args: {
  supabase: SupabaseClient;
  accountId: string;
  reuniao: ReuniaoDaPauta;
  acao: Acao;
  alvo: AlvoDaAcao;
  valor: number | null;
}): Promise<DesfechoDaAcao> {
  const { supabase, accountId, reuniao, acao, alvo, valor } = args;
  const negocio = reuniao.negocio;
  if (!negocio) return 'falhou';

  const novaEtapa = alvo.id !== negocio.etapaId ? alvo.id : undefined;
  const novoValor = acao === 'proposta' && valor !== null ? valor : undefined;

  if (novaEtapa !== undefined || novoValor !== undefined) {
    // Objeto LITERAL, só etapa e valor: chave `undefined` não vai no corpo
    // (o JSON a descarta), e o pino dos escritores de título
    // (`titulo-do-card.chamadores.test.ts`) enxerga que aqui não há título.
    const { data, error } = await supabase
      .from('deals')
      .update({ stage_id: novaEtapa, value: novoValor })
      .eq('id', negocio.id)
      .eq('stage_id', negocio.etapaId)
      .select('id');
    if (error) return 'falhou';
    if (!data || data.length === 0) return 'card_mudou';
    if (novaEtapa !== undefined) avisarDrenagemDeFunil();
  }

  const marco = acao === 'qualificada' ? 'qualificada' : 'resultado';
  const { error } = await supabase.from('cb_reunioes_marcos').upsert(
    {
      account_id: accountId,
      origem: reuniao.origem,
      reuniao_id: reuniao.reuniaoId,
      marco,
      resultado: marco === 'resultado' ? acao : null,
      valor: acao === 'proposta' ? valor : null,
    },
    { onConflict: 'account_id,origem,reuniao_id,marco' },
  );
  return error ? 'registro_falhou' : 'ok';
}

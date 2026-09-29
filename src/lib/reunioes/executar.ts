import type { SupabaseClient } from '@supabase/supabase-js';

import { avisarDrenagemDeFunil } from '@/lib/automations/avisar-drenagem';

import type { Acao, AlvoDaAcao, ReuniaoDaPauta } from './pauta';

export type DesfechoDaAcao = 'ok' | 'card_mudou' | 'falhou' | 'registro_falhou';

/**
 * Executa um botão da pauta: move o card (quando há destino) e registra a
 * marcação.
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
 * ⚠️ A escrita é CERCADA pela etapa em que a tela viu o card E pelo status
 * aberto: entre carregar a pauta e clicar, uma automação (o Calendly move para
 * "Reunião Agendada") ou um colega pode ter movido o card, ou marcado ganho ou
 * perdido pelo botão do card — passar por cima levaria o card para trás, ou
 * reabriria o perdido (1031). Zero linhas = `card_mudou`: a tela recarrega e
 * a pessoa decide de novo. Quem decide se o card pode andar é `comoMarcar`;
 * `destino` nulo = só o registro.
 *
 * O card primeiro, o registro depois. Se o registro falhar com o card já
 * movido, a trilha ainda resolve a reunião (a tela lê as duas fontes).
 */
export async function executarAcao(args: {
  supabase: SupabaseClient;
  accountId: string;
  reuniao: ReuniaoDaPauta;
  acao: Acao;
  destino: AlvoDaAcao | null;
  valor: number | null;
}): Promise<{ desfecho: DesfechoDaAcao; moveu: boolean }> {
  const { supabase, accountId, reuniao, acao, destino, valor } = args;
  const negocio = reuniao.negocio;
  let moveu = false;

  // "Com proposta" SEM valor não grava nada, nem o card nem o registro
  // (pedido do operador, 29/09/2026): o card só entra em Proposta Realizada
  // com o valor, porque é nessa entrada que a TinTim recebe o valor do card.
  // A tela já exige o valor; esta é a trava no ponto de escrita.
  if (acao === 'proposta' && !(valor !== null && valor > 0)) return { desfecho: 'falhou', moveu };

  if (destino && negocio) {
    const novaEtapa = destino.id !== negocio.etapaId ? destino.id : undefined;
    const novoValor = acao === 'proposta' ? (valor as number) : undefined;
    if (novaEtapa !== undefined || novoValor !== undefined) {
      // Objeto LITERAL, só etapa e valor: chave `undefined` não vai no corpo
      // (o JSON a descarta), e o pino dos escritores de título
      // (`titulo-do-card.chamadores.test.ts`) enxerga que aqui não há título.
      const { data, error } = await supabase
        .from('deals')
        .update({ stage_id: novaEtapa, value: novoValor })
        .eq('id', negocio.id)
        .eq('stage_id', negocio.etapaId)
        .eq('status', 'open')
        .select('id');
      if (error) return { desfecho: 'falhou', moveu };
      if (!data || data.length === 0) return { desfecho: 'card_mudou', moveu };
      moveu = novaEtapa !== undefined;
      if (moveu) avisarDrenagemDeFunil();
    } else {
      // O card JÁ estava na etapa do botão: nada a escrever nele, mas a MESMA
      // cerca vale — se alguém o moveu ou fechou depois da carga, registrar
      // o resultado afirmaria um estado que o card não tem mais (Codex, PR
      // #339).
      const { data, error } = await supabase
        .from('deals')
        .select('id')
        .eq('id', negocio.id)
        .eq('stage_id', negocio.etapaId)
        .eq('status', 'open');
      if (error) return { desfecho: 'falhou', moveu };
      if (!data || data.length === 0) return { desfecho: 'card_mudou', moveu };
    }
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
  return { desfecho: error ? 'registro_falhou' : 'ok', moveu };
}

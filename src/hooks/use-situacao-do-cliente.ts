'use client';

import { useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { funilNoEscopo } from '@/lib/perfis/escopo';
import {
  situacoesDoCliente,
  type EtapaMarcada,
  type EventoDeSaida,
  type NegocioDoContato,
  type SituacaoNoFunil,
} from '@/lib/pipelines/situacao-do-cliente';
import { createClient } from '@/lib/supabase/client';

interface Lido {
  negocios: NegocioDoContato[];
  saidas: EventoDeSaida[];
  etapas: EtapaMarcada[];
}

/**
 * A situação do contrato do cliente pela etapa do funil (1070), para a faixa
 * "Cliente rescindido / finalizado" do fio. A regra (etapa atual por funil,
 * ou a de onde o card saiu; marca, nunca nome) mora em
 * `src/lib/pipelines/situacao-do-cliente.ts`.
 *
 * ⚠️ Carimbo `{ de, … }` (o fio não remonta ao trocar de cliente): fora do
 * contato atual a resposta é `null`, e a faixa de um cliente nunca aparece
 * na conversa de outro. `null` também é "a leitura falhou" — a faixa cala,
 * nunca afirma "cliente ativo".
 *
 * ⚠️ O estado guarda o que o BANCO devolveu; o recorte pelo perfil (igual ao
 * painel: funil fora do escopo de quem vê não acende a faixa) é DERIVADO no
 * render. Recortado no efeito, a lente "Ver como" mostraria a faixa do perfil
 * anterior até a releitura voltar — e para sempre, se ela falhasse.
 */
export function useSituacaoDoCliente(
  contactId: string | null | undefined,
  /** O token de resync do fio: sobe ao voltar à aba e na reconexão. */
  resyncToken: number = 0,
  /**
   * Muda quando chega evento novo na trilha do lead (`useLeadEvents`, em
   * tempo real): mover o card de etapa ou de funil com a conversa aberta —
   * pelo painel, pelo quadro, por automação — acende ou apaga a faixa sem
   * precisar trocar de cliente.
   */
  versaoDaTrilha: string = '',
): { situacoes: SituacaoNoFunil[] | null } {
  const { acesso } = useAuth();
  const [estado, setEstado] = useState<{ de: string | null; lido: Lido | null }>({ de: null, lido: null });

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const [negocios, saidas, etapas] = await Promise.all([
        supabase.from('deals').select('id, pipeline_id, stage_id, created_at').eq('contact_id', contactId),
        // Só o que pode ser SAÍDA de funil (máximo medido: 84 eventos de
        // etapa por contato; o teto abaixo sobra).
        supabase
          .from('cb_lead_events')
          .select('id, event_type, from_pipeline_id, from_stage_id, to_pipeline_id, occurred_at')
          .eq('contact_id', contactId)
          .in('event_type', ['pipeline_changed', 'deal_deleted'])
          .order('occurred_at', { ascending: false })
          .limit(500),
        // Poucas etapas marcadas por conta (duas no CB).
        supabase
          .from('pipeline_stages')
          .select('id, name, situacao_do_cliente, pipeline:pipelines(name)')
          .not('situacao_do_cliente', 'is', null),
      ]);
      if (!vivo) return;
      const erro = negocios.error ?? saidas.error ?? etapas.error;
      if (erro) {
        console.error('[situacao-do-cliente] leitura falhou:', erro.message);
        // Recarga que falha mantém o que já era DESTE contato; a primeira
        // leitura que falha deixa a faixa calada.
        setEstado((atual) => (atual.de === contactId ? atual : { de: contactId, lido: null }));
        return;
      }
      setEstado({
        de: contactId,
        lido: {
          negocios: (negocios.data ?? []) as NegocioDoContato[],
          saidas: (saidas.data ?? []) as EventoDeSaida[],
          etapas: (etapas.data ?? []) as unknown as EtapaMarcada[],
        },
      });
    })();
    return () => {
      vivo = false;
    };
  }, [contactId, resyncToken, versaoDaTrilha]);

  // Derivado DENTRO do memo, com dependências cruas: o React Compiler recusa
  // memo que depende de valor derivado fora dele.
  const situacoes = useMemo(() => {
    const lido = contactId && estado.de === contactId ? estado.lido : null;
    if (!lido) return null;
    const noEscopo = (funil: string | null) => !funil || funilNoEscopo(acesso, funil);
    return situacoesDoCliente(
      lido.negocios.filter((n) => noEscopo(n.pipeline_id)),
      lido.saidas.filter((e) => noEscopo(e.from_pipeline_id)),
      lido.etapas,
    );
  }, [contactId, estado, acesso]);

  return { situacoes };
}

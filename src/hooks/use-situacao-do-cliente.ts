'use client';

import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { funilNoEscopo } from '@/lib/perfis/escopo';
import {
  situacoesDoCliente,
  type NegocioComEtapa,
  type SituacaoNoFunil,
} from '@/lib/pipelines/situacao-do-cliente';
import { createClient } from '@/lib/supabase/client';

/**
 * A situação do contrato do cliente pela etapa do funil (1070), para a faixa
 * "Cliente rescindido / finalizado" do fio. A regra (card mais recente por
 * funil, marca da etapa) mora em `src/lib/pipelines/situacao-do-cliente.ts`.
 *
 * ⚠️ Carimbo `{ de, … }` (o fio não remonta ao trocar de cliente): fora do
 * contato atual a resposta é `null`, e a faixa de um cliente nunca aparece
 * na conversa de outro. `null` também é "a leitura falhou" — a faixa cala,
 * nunca afirma "cliente ativo".
 *
 * Recorte por perfil, igual ao painel: negócio de funil fora do escopo de
 * quem vê não acende a faixa (cada equipe vê o seu; `pipeline_id` nulo passa,
 * como todo "sem carimbo" do projeto).
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
  const [estado, setEstado] = useState<{ de: string | null; situacoes: SituacaoNoFunil[] | null }>({
    de: null,
    situacoes: null,
  });

  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void (async () => {
      const { data, error } = await createClient()
        .from('deals')
        .select('pipeline_id, created_at, stage:pipeline_stages(name, situacao_do_cliente, pipeline:pipelines(name))')
        .eq('contact_id', contactId);
      if (!vivo) return;
      if (error) {
        console.error('[situacao-do-cliente] leitura falhou:', error.message);
        // Recarga que falha mantém o que já era DESTE contato; a primeira
        // leitura que falha deixa a faixa calada.
        setEstado((atual) => (atual.de === contactId ? atual : { de: contactId, situacoes: null }));
        return;
      }
      const negocios = ((data ?? []) as unknown as NegocioComEtapa[]).filter(
        (n) => !n.pipeline_id || funilNoEscopo(acesso, n.pipeline_id),
      );
      setEstado({ de: contactId, situacoes: situacoesDoCliente(negocios) });
    })();
    return () => {
      vivo = false;
    };
  }, [contactId, resyncToken, versaoDaTrilha, acesso]);

  return { situacoes: contactId && estado.de === contactId ? estado.situacoes : null };
}

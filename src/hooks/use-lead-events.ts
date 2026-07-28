'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { ordenarPorTempo } from '@/lib/lead-events/describe';
import type { LeadEvent } from '@/types';

/**
 * Trilha de atividade de um contato (migration 912).
 *
 * ⚠️ Busca por `contact_id`, não por conversa: tag não tem conversa nenhuma, e
 * há uma conversa por contato por conta desde a 036 — filtrar por conversa
 * perderia metade dos eventos sem ganhar nada.
 *
 * ⚠️ Sem realtime, e de propósito. Nenhuma das ações que geram evento acontece
 * na mesma tela onde a trilha é lida: arrastar card é o Kanban, aplicar tag é
 * a tela de Contatos. Assinar a tabela custaria publicação nova e um canal por
 * conversa aberta para cobrir uma simultaneidade que não existe. A lista
 * recarrega quando o contato muda ou quando o `token` é incrementado — é assim
 * que o botão de atualizar da thread arrasta a trilha junto.
 */
export function useLeadEvents(contactId: string | null | undefined, token = 0) {
  const [eventos, setEventos] = useState<LeadEvent[]>([]);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(async () => {
    if (!contactId) {
      setEventos([]);
      return;
    }
    setCarregando(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('cb_lead_events')
      .select('*')
      .eq('contact_id', contactId)
      // Teto de segurança: um lead antigo e muito mexido não pode travar a
      // abertura da conversa. Busca as MAIS RECENTES e reordena no cliente.
      .order('occurred_at', { ascending: false })
      .limit(200);

    if (error) {
      // Falha aqui não pode derrubar a conversa: a trilha é informação
      // acessória do atendimento, e o chat precisa abrir de qualquer jeito.
      console.warn('[lead-events] falha ao buscar histórico:', error.message);
      setEventos([]);
    } else {
      setEventos(ordenarPorTempo((data ?? []) as LeadEvent[]));
    }
    setCarregando(false);
  }, [contactId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar();
  }, [buscar, token]);

  return { eventos, carregando, recarregar: buscar };
}

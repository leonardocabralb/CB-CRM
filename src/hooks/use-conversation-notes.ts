'use client';

import { useCallback, useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { ConversationNote } from '@/types';

/**
 * Anotações internas de uma conversa (migration 918).
 *
 * ⚠️ Busca por `conversation_id`, e não por contato como o `useLeadEvents`.
 * É a única chave que existe em conversa de grupo — grupo não tem contato.
 *
 * ⚠️ COM realtime, ao contrário da trilha de atividade. O argumento que
 * manteve a 912 fora se inverte aqui: a anotação é escrita exatamente na tela
 * onde é lida (o compositor), e dois atendentes na mesma conversa é o caso
 * normal, não a exceção.
 *
 * ⚠️ O realtime cobre INSERT, não DELETE. Com a REPLICA IDENTITY padrão, a
 * linha antiga de um DELETE chega só com a chave primária, o que impede tanto
 * o filtro por conversa quanto a checagem de RLS — o evento simplesmente não
 * é entregue. Na prática isso quase não aparece: quem apaga é quem vê sumir
 * (`remover` mexe no estado local na hora), e a anotação apagada por um
 * colega some na próxima abertura da conversa. Trocar a replica identity da
 * tabela para FULL só por isso custaria mais WAL em toda escrita.
 */
export function useConversationNotes(
  conversationId: string | null | undefined,
  token = 0,
) {
  const [notas, setNotas] = useState<ConversationNote[]>([]);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(async () => {
    if (!conversationId) {
      setNotas([]);
      return;
    }
    setCarregando(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from('cb_conversation_notes')
      .select('*')
      .eq('conversation_id', conversationId)
      // Mesmo teto de segurança da trilha: busca as mais recentes e deixa a
      // ordenação final para o `intercalar`, que ordena o fio inteiro.
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      // Falha aqui não pode derrubar a conversa — anotação é acessória ao
      // atendimento e o chat precisa abrir de qualquer jeito.
      console.warn('[notas] falha ao buscar anotações:', error.message);
      setNotas([]);
    } else {
      setNotas((data ?? []) as ConversationNote[]);
    }
    setCarregando(false);
  }, [conversationId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar();
  }, [buscar, token]);

  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`notas:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cb_conversation_notes',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const linha = payload.new as ConversationNote;
          setNotas((anteriores) =>
            // O próprio autor já inseriu a linha no estado ao salvar; sem esta
            // guarda a anotação apareceria duas vezes para quem a escreveu.
            anteriores.some((n) => n.id === linha.id)
              ? anteriores
              : [...anteriores, linha],
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId]);

  /** Tira a anotação da lista local. Quem apaga vê sumir na hora. */
  const remover = useCallback((id: string) => {
    setNotas((anteriores) => anteriores.filter((n) => n.id !== id));
  }, []);

  /** Põe a anotação recém-criada na lista, sem esperar o realtime. */
  const acrescentar = useCallback((nota: ConversationNote) => {
    setNotas((anteriores) =>
      anteriores.some((n) => n.id === nota.id) ? anteriores : [...anteriores, nota],
    );
  }, []);

  return { notas, carregando, recarregar: buscar, remover, acrescentar };
}

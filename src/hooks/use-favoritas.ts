'use client';

// ============================================================
// As conversas que EU marquei (migration 924).
//
// ⚠️ É pessoal, não da conta. A policy de leitura já filtra por
// `user_id = auth.uid()`, então a consulta abaixo não precisa repetir o
// filtro — mas o `user_id` no insert precisa estar certo, porque a policy de
// escrita compara com ele.
//
// Escrita direta do navegador, sob RLS, e isso é deliberado: é o mesmo molde
// das etiquetas e da atribuição de responsável. Uma rota de servidor só faria
// sentido se houvesse efeito colateral (como na anotação, que dispara
// notificação de menção) — aqui não há.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';

export interface UseFavoritasResult {
  /** Ids das conversas que este membro marcou. */
  favoritas: Set<string>;
  /** Marca ou desmarca. Devolve `false` quando a gravação falhou. */
  alternar: (conversationId: string) => Promise<boolean>;
}

export function useFavoritas(): UseFavoritasResult {
  const { user, accountId } = useAuth();
  // Extraído aqui, e não lido como `user?.id` lá dentro, porque o React
  // Compiler infere a dependência como o objeto `user` inteiro e recusa a
  // memoização manual — o hook inteiro deixa de ser otimizado.
  const userId = user?.id ?? null;
  const [favoritas, setFavoritas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    let cancelado = false;
    void (async () => {
      const { data, error } = await supabase
        .from('cb_conversation_favorites')
        .select('conversation_id');
      if (cancelado || error || !data) return;
      setFavoritas(
        new Set(data.map((r) => (r as { conversation_id: string }).conversation_id)),
      );
    })();
    return () => {
      cancelado = true;
    };
  }, [userId]);

  const alternar = useCallback(
    async (conversationId: string): Promise<boolean> => {
      if (!userId || !accountId) return false;
      const supabase = createClient();
      const jaEra = favoritas.has(conversationId);

      // Otimista: a estrela acende no clique. O rollback abaixo é o que
      // impede a mentira — sem ele a estrela ficaria acesa até o próximo
      // carregamento e o operador acharia que marcou.
      setFavoritas((prev) => {
        const proximo = new Set(prev);
        if (jaEra) proximo.delete(conversationId);
        else proximo.add(conversationId);
        return proximo;
      });

      const { error } = jaEra
        ? await supabase
            .from('cb_conversation_favorites')
            .delete()
            .eq('conversation_id', conversationId)
            .eq('user_id', userId)
        : await supabase.from('cb_conversation_favorites').insert({
            user_id: userId,
            conversation_id: conversationId,
            account_id: accountId,
          });

      // 23505 = a linha já existia. Acontece quando a leitura inicial falhou
      // (a estrela nasceu apagada) e o operador clicou para marcar de novo:
      // o estado que ele queria é exatamente o que já está no banco.
      if (error && error.code !== '23505') {
        setFavoritas((prev) => {
          const volta = new Set(prev);
          if (jaEra) volta.add(conversationId);
          else volta.delete(conversationId);
          return volta;
        });
        return false;
      }
      return true;
    },
    [userId, accountId, favoritas],
  );

  return { favoritas, alternar };
}

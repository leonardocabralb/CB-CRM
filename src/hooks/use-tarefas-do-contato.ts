'use client';

// ============================================================
// As tarefas de UM cliente (944) — a aba da ficha e a seção da conversa.
//
// ⚠️ Irmão do `use-tarefas`, e não um caso dele. Lá o recorte é por PESSOA
// (minhas, as que deleguei, as da equipe) e o volume justifica paginar o
// acervo; aqui o recorte é o cliente, o conjunto é pequeno por natureza, e
// esconder metade das tarefas de um cliente atrás de "carregar mais"
// esvaziaria a única pergunta que esta lista responde: "o que há em aberto
// com esta pessoa?".
//
// ⚠️ Sem embed de contato e sem a conversa: quem chama JÁ está na ficha ou na
// conversa daquele cliente, e a linha esconde o nome (`ocultarCliente`).
// Buscar as duas coisas seria pagar por informação que a tela não mostra.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { Task } from '@/types';

/**
 * Teto defensivo. Um cliente com mais de 200 tarefas é um cenário que não
 * existe hoje; o número está aqui para o dia em que existir não derrubar a
 * abertura da ficha.
 */
const TETO = 200;

export interface TarefasDoContato {
  tarefas: Task[];
  carregando: boolean;
  /** ⚠️ Separado de "lista vazia" — ver `use-tarefas`. */
  falhou: boolean;
  /** Abertas, para a etiqueta da aba. */
  abertas: number;
  recarregar: () => void;
}

export function useTarefasDoContato(
  contactId: string | null | undefined,
): TarefasDoContato {
  const { accountId } = useAuth();
  const [tarefas, setTarefas] = useState<Task[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [falhou, setFalhou] = useState(false);
  const [token, setToken] = useState(0);

  const recarregar = useCallback(() => setToken((t) => t + 1), []);

  // ⚠️ Limpo DURANTE a render ao trocar de cliente, não num efeito. Num efeito,
  // a ficha do cliente novo chegaria a pintar uma vez com as tarefas do
  // anterior — e a lista de "o que falta fazer com esta pessoa" mostrando o
  // trabalho de outra é o erro mais caro que esta tela pode cometer.
  const [contatoAnterior, setContatoAnterior] = useState(contactId);
  if (contactId !== contatoAnterior) {
    setContatoAnterior(contactId);
    setTarefas([]);
  }

  useEffect(() => {
    if (!contactId || !accountId) return;
    const supabase = createClient();
    let cancelado = false;

    (async () => {
      setCarregando(true);
      const { data, error } = await supabase
        .from('cb_tasks')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        // As abertas primeiro e, dentro delas, as mais urgentes: se o teto
        // morder um dia, o que fica é o que alguém ainda tem de fazer.
        .order('status', { ascending: true })
        .order('vence_em', { ascending: true })
        .limit(TETO);

      if (cancelado) return;
      if (error) {
        console.error('[useTarefasDoContato] falhou:', error.message);
        setFalhou(true);
        setCarregando(false);
        return;
      }
      setTarefas((data ?? []) as Task[]);
      setFalhou(false);
      setCarregando(false);
    })();

    return () => {
      cancelado = true;
    };
  }, [contactId, accountId, token]);

  return {
    tarefas,
    carregando,
    falhou,
    abertas: tarefas.filter((t) => t.status === 'aberta').length,
    recarregar,
  };
}

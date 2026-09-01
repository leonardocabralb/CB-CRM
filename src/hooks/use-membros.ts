'use client';

// ============================================================
// Os membros da conta, para o browser (944).
//
// Molde do `use-channels`: uma busca por montagem, falha silenciosa. O
// `fetchAccountMembers` já engole o erro e devolve `[]` — este hook só evita
// repetir o par `useState`/`useEffect` com bandeira de cancelamento nas telas
// que precisam da lista (o formulário de tarefa e o filtro por pessoa).
//
// ⚠️ Lista vazia NÃO é o mesmo que "sozinho na conta", e quem usa precisa
// decidir o que fazer: o formulário de tarefa cai no próprio usuário como
// destinatário, que é sempre um alvo válido, em vez de mostrar um seletor
// vazio que não deixa criar nada.
// ============================================================

import { useCallback, useEffect, useState } from 'react';

import { fetchAccountMembersOrNull } from '@/lib/account/members';
import type { AccountMember } from '@/types';

export interface UseMembrosResult {
  membros: AccountMember[];
  /** `true` até a primeira resposta chegar (ou falhar). */
  carregando: boolean;
  /**
   * ⚠️ A busca FALHOU — a lista vazia não diz nada sobre a conta. Sem esta
   * distinção, o formulário de tarefa lia `[]` como "único membro" e
   * auto-atribuía ao criador numa conta com equipe, numa falha de rede.
   */
  falhou: boolean;
  /** Refaz a busca — o botão "tentar de novo" do formulário de tarefa (#32):
   *  sem ele, a falha só se resolvia recarregando a página inteira. */
  recarregar: () => void;
}

export function useMembros(): UseMembrosResult {
  const [membros, setMembros] = useState<AccountMember[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setCarregando(true);
    (async () => {
      const lista = await fetchAccountMembersOrNull();
      if (!cancelado) {
        setMembros(lista ?? []);
        setFalhou(lista === null);
        setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [nonce]);

  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  return { membros, carregando, falhou, recarregar };
}

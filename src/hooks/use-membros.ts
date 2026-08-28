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

import { useEffect, useState } from 'react';

import { fetchAccountMembers } from '@/lib/account/members';
import type { AccountMember } from '@/types';

export interface UseMembrosResult {
  membros: AccountMember[];
  /** `true` até a primeira resposta chegar (ou falhar). */
  carregando: boolean;
}

export function useMembros(): UseMembrosResult {
  const [membros, setMembros] = useState<AccountMember[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const lista = await fetchAccountMembers();
      if (!cancelado) {
        setMembros(lista);
        setCarregando(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  return { membros, carregando };
}

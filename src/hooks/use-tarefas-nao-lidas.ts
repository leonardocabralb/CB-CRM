'use client';

// ============================================================
// Quantas tarefas ainda não lidas apontam para MIM (migration 944).
//
// Alimenta a etiqueta do menu lateral, que é o que faz a feature existir para
// quem passa o dia no inbox: sem ela, a tarefa encaminhada às 9h só aparece
// quando a pessoa lembra de abrir a tela.
//
// ⚠️ AO CONTRÁRIO DAS NOTIFICAÇÕES, A RLS NÃO AJUDA A CONTAR. `notifications`
// é recortada por `auth.uid() = user_id`, então lá qualquer linha que chega é
// do próprio usuário. Aqui a policy deixa a conta INTEIRA ser lida (decisão do
// operador: todo mundo vê tudo), então cada evento de realtime pode ser de uma
// tarefa de outra pessoa — e o filtro por destinatário tem de ser feito à mão,
// nos dois lados de todo evento.
// ============================================================

import { useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { Task } from '@/types';

/**
 * A linha entra na conta da etiqueta?
 *
 * Os três testes juntos, e nenhum é dispensável: é minha, ainda não foi vista,
 * e ainda está de pé. Sem o `status`, dar baixa numa tarefa que nunca foi
 * aberta deixaria o número pendurado para sempre — e não há nada na tela que
 * o operador possa clicar para zerá-lo.
 */
function contaParaMim(linha: Partial<Task>, userId: string): boolean {
  return (
    linha.responsavel_user_id === userId &&
    !linha.lida_em &&
    linha.status === 'aberta'
  );
}

export function useTarefasNaoLidas(): number {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [count, setCount] = useState(0);

  useEffect(() => {
    // Sem sessão não há o que assinar nem o que contar. O zero é DERIVADO no
    // retorno, não escrito aqui: zerar por efeito seria um render a mais para
    // dizer o que a ausência de `userId` já diz.
    if (!userId) return;

    const supabase = createClient();
    let cancelado = false;

    (async () => {
      // `head: true` não traz linha nenhuma — só o total no cabeçalho.
      const { count: total, error } = await supabase
        .from('cb_tasks')
        .select('*', { count: 'exact', head: true })
        .eq('responsavel_user_id', userId)
        .is('lida_em', null)
        .eq('status', 'aberta');
      if (cancelado || error) return;
      setCount(total ?? 0);
    })();

    const channel = supabase
      .channel('cb-tasks-unread-count')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cb_tasks' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            if (contaParaMim(payload.new as Task, userId)) {
              setCount((n) => n + 1);
            }
            return;
          }

          if (payload.eventType === 'DELETE') {
            if (contaParaMim(payload.old as Partial<Task>, userId)) {
              setCount((n) => Math.max(0, n - 1));
            }
            return;
          }

          // ⚠️ UPDATE é a diferença entre ANTES e DEPOIS, e é por isso que a
          // 944 pôs `REPLICA IDENTITY FULL` na tabela. Aqui, ao contrário das
          // notificações, o UPDATE não é sempre "virou lida": pode ser marcar
          // como não lida de novo (+1), concluir (−1), reabrir (+1) ou passar
          // a tarefa para outra pessoa (−1 para mim, +1 para ela). Derivar só
          // da linha nova erraria em metade desses casos.
          const antes = contaParaMim(payload.old as Partial<Task>, userId);
          const depois = contaParaMim(payload.new as Task, userId);
          if (antes === depois) return;
          setCount((n) => Math.max(0, n + (depois ? 1 : -1)));
        },
      )
      .subscribe();

    return () => {
      cancelado = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  // ⚠️ Derivado, e não o estado cru: entre sair da conta e o efeito rodar, o
  // `count` ainda guarda o número da sessão anterior — e ele apareceria, por um
  // instante, no menu de quem acabou de deslogar.
  return userId ? count : 0;
}

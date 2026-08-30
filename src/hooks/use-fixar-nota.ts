'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

import type { ConversationNote } from '@/types';

/**
 * Fixar/desafixar uma anotação (migration 951), de qualquer tela.
 *
 * ⚠️ Passa pela ROTA (`PATCH /api/cb/notes/[id]`) porque UPDATE em
 * `cb_conversation_notes` segue revogado do navegador (918/920): um
 * `.update()` do cliente voltaria "0 linhas" com cara de sucesso. Quem
 * garante "uma por cliente" é o índice parcial da 951, não a rota.
 *
 * ⚠️ Mora aqui, e não dentro de cada tela, porque são DOIS call sites — a
 * aba Notas do painel e a faixa do topo do fio — e os dois dependem da MESMA
 * reconciliação local (`aplicarFixacao`): a nota devolvida entra no lugar
 * dela e qualquer outra fixada é zerada, porque fixar a nova desafixou a
 * antiga no servidor. Duas cópias que divergissem apareceriam na tela como
 * duas anotações fixadas ao mesmo tempo, que o banco não permite.
 *
 * O `aplicarFixacao` recebido é o do `useConversationNotes` de QUEM CHAMA —
 * cada montagem do hook tem seu próprio estado, e é ele que descarta
 * resposta em voo de outra conversa.
 */
export function useFixarNota(aplicarFixacao: (nota: ConversationNote) => void) {
  const t = useTranslations('Inbox.note');
  /** Id da nota em trânsito — o botão daquela linha fica desabilitado. */
  const [fixando, setFixando] = useState<string | null>(null);

  const fixarNota = useCallback(
    async (nota: ConversationNote, fixar: boolean) => {
      setFixando(nota.id);
      try {
        const res = await fetch(`/api/cb/notes/${nota.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fixada: fixar }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.note) {
          // 409 (corrida perdida, nota apagada no meio, nota de grupo) e 500
          // caem no mesmo aviso: o operador não tem ação diferente para cada
          // um, e o estado certo chega pelo realtime da própria tabela.
          toast.error(t('pinError'));
          return;
        }
        aplicarFixacao(json.note as ConversationNote);
      } catch {
        toast.error(t('pinError'));
      } finally {
        setFixando(null);
      }
    },
    [aplicarFixacao, t]
  );

  return { fixarNota, fixando };
}

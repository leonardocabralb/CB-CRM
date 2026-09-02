'use client';

import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';

/**
 * Apagar uma anotação interna (918), de qualquer tela.
 *
 * ⚠️ Vai DIRETO do navegador — ao contrário de criar, que precisa da rota por
 * causa da notificação da menção, e de fixar (951), que precisa dela porque
 * UPDATE nesta tabela é revogado. Aqui a própria RLS decide (autor OU admin),
 * então não há o que validar no meio.
 *
 * ⚠️ Mora aqui, e não dentro de cada tela, pela MESMA razão do
 * `useFixarNota`: eram DOIS call sites antes (o fio e, agora, a aba Notas do
 * painel e a do grupo), e o que os une é a guarda do `count` abaixo — a parte
 * que é fácil esquecer numa segunda cópia e cujo sintoma é silencioso.
 *
 * ⚠️⚠️ `count`, NUNCA só `error`. A policy é "autor OU admin", e RLS que barra
 * DELETE não devolve erro: devolve **0 linhas**, que pareceria sucesso. Sem
 * isto a anotação some da tela, continua no banco e reaparece na próxima
 * abertura da conversa, sem nada explicando. O botão já é escondido por
 * `podeApagar`, então este ramo só dispara quando a tela e a RLS discordam —
 * que é exatamente quando não dá para calar.
 *
 * @param removerLocal  tira a nota da lista antes da confirmação do banco
 *                      (quem apaga vê sumir na hora)
 * @param recarregar    desfaz o otimismo relendo a lista quando o DELETE não
 *                      alcançou nenhuma linha
 */
export function useApagarNota(
  removerLocal: (id: string) => void,
  recarregar: () => void | Promise<void>
) {
  const t = useTranslations('Inbox.note');

  const apagarNota = useCallback(
    async (id: string) => {
      const supabase = createClient();
      removerLocal(id);
      const { error, count } = await supabase
        .from('cb_conversation_notes')
        .delete({ count: 'exact' })
        .eq('id', id);
      if (error || !count) {
        toast.error(t('deleteFailed'));
        void recarregar();
      }
    },
    [removerLocal, recarregar, t]
  );

  return { apagarNota };
}

'use client';

import { useCallback, useEffect, useId, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { Meeting } from '@/types';

/**
 * As reuniões de um período (migration 945).
 *
 * ⚠️ LÊ DIRETO DA TABELA, sob RLS — não há rota de GET. A 945 dá `SELECT` ao
 * `authenticated` justamente para isto; a escrita é que passa por
 * `/api/cb/agenda`, porque carimba `autor_nome`/`owner_nome` e confere o
 * responsável contra a conta.
 *
 * ⚠️ COM realtime, e pelo motivo da 921: dois operadores marcando na mesma
 * agenda é o caso comum num escritório. Sem isto, o segundo só descobre a
 * reunião do colega quando a restrição `EXCLUDE` do banco recusa a dele — erro
 * na cara de quem salvou por último, num horário que a tela mostrava livre
 * segundos antes.
 *
 * ⚠️ Cobre UPDATE e DELETE, que só funcionam porque a 945 pôs a tabela em
 * REPLICA IDENTITY FULL. Sem ela o payload de UPDATE traz só a chave primária
 * em `old`, e mover uma reunião de terça para quinta a deixaria desenhada nos
 * DOIS dias até alguém recarregar.
 */
export function useReunioes(
  de: Date | null,
  ate: Date | null,
  token = 0,
) {
  const [reunioes, setReunioes] = useState<Meeting[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  /**
   * ⚠️ Identidade desta montagem no nome do canal — mesma armadilha do
   * `use-conversation-notes`: pedir duas vezes o mesmo tópico devolve o canal
   * já inscrito, e o `.on()` seguinte estoura derrubando a página.
   */
  const instancia = useId();

  const deISO = de ? de.toISOString() : null;
  const ateISO = ate ? ate.toISOString() : null;

  const buscar = useCallback(async (vivo: () => boolean = () => true) => {
    if (!deISO || !ateISO) return;

    const supabase = createClient();
    setCarregando(true);

    // ⚠️ O recorte é `starts_at` dentro da janela — reunião que COMEÇOU antes
    // do período e ainda está correndo fica de fora. É aceitável porque a
    // janela da tela é sempre um mês ou uma semana inteira, e o CHECK de
    // duração máxima (24h) impede reunião que atravesse a virada de mês.
    const { data, error } = await supabase
      .from('cb_meetings')
      .select('*')
      .gte('starts_at', deISO)
      .lte('starts_at', ateISO)
      .order('starts_at', { ascending: true });

    // ⚠️ O resultado é DESCARTADO se o período já não for o pedido.
    // Clicar "próximo mês" três vezes seguidas — que é o uso normal — deixa
    // três buscas no ar, e quem responde por último não é necessariamente
    // quem foi chamado por último. Sem isto a tela mostra o mês errado.
    if (!vivo()) return;

    if (error) {
      setErro(error.message);
      setReunioes([]);
    } else {
      setErro(null);
      setReunioes((data ?? []) as Meeting[]);
    }
    setCarregando(false);
  }, [deISO, ateISO]);

  useEffect(() => {
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [buscar, token]);

  useEffect(() => {
    if (!deISO || !ateISO) return;

    const supabase = createClient();
    const canal = supabase
      .channel(`reunioes:${instancia}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cb_meetings' },
        () => {
          // Rebusca em vez de aplicar o payload à mão: o recorte por período
          // teria de ser reimplementado aqui, e errar nele deixaria reunião
          // fantasma de outro mês na tela.
          void buscar();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(canal);
    };
  }, [instancia, buscar, deISO, ateISO]);

  return { reunioes, carregando, erro, recarregar: buscar };
}

/**
 * As reuniões de um contato — para a aba na ficha do cliente.
 *
 * Sem recorte de período: a ficha mostra o histórico inteiro, que é curto por
 * natureza (um cliente tem dezenas de reuniões, não milhares).
 */
export function useReunioesDoContato(contactId: string | null | undefined) {
  const [reunioes, setReunioes] = useState<Meeting[]>([]);
  const [carregando, setCarregando] = useState(false);

  const buscar = useCallback(
    async (vivo: () => boolean = () => true) => {
      if (!contactId) {
        setReunioes([]);
        return;
      }

      const supabase = createClient();
      setCarregando(true);

      const { data } = await supabase
        .from('cb_meetings')
        .select('*')
        .eq('contact_id', contactId)
        .order('starts_at', { ascending: false });

      // Mesma razão do hook acima: a ficha troca de cliente com um clique.
      if (!vivo()) return;

      setReunioes((data ?? []) as Meeting[]);
      setCarregando(false);
    },
    [contactId],
  );

  useEffect(() => {
    let vivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void buscar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [buscar]);

  return { reunioes, carregando, recarregar: buscar };
}

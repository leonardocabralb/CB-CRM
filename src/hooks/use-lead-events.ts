'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { juntarEventos } from '@/lib/lead-events/describe';
import type { LeadEvent } from '@/types';

const SEM_EVENTOS: LeadEvent[] = [];

/**
 * ⚠️ Cada assinatura tem um tópico ÚNICO, e não só um por montagem.
 *
 * O cliente do Supabase devolve o canal que já existe quando o tópico se
 * repete, e o que está SAINDO continua na lista até o servidor confirmar a
 * saída. Reusar o tópico nesse intervalo — o fio e a aba Histórico montam o
 * hook para o mesmo contato ao mesmo tempo, o StrictMode do `next dev` monta
 * cada efeito duas vezes, e a troca rápida de contato vai e volta — devolve o
 * canal que está saindo: o `.subscribe()` dele não faz nada e o evento nunca
 * chega. Com um tópico por assinatura, nenhuma cruza com outra.
 */
let canaisAbertos = 0;

/**
 * Trilha de atividade de um contato (migration 912), em tempo real desde a
 * 1059.
 *
 * ⚠️ Busca por `contact_id`, não por conversa: tag não tem conversa nenhuma, e
 * há uma conversa por contato por conta desde a 036 — filtrar por conversa
 * perderia metade dos eventos sem ganhar nada.
 *
 * ⚠️ COM tempo real, ao contrário do que a 912 decidiu. O argumento dela era
 * que nenhuma ação que gera evento acontecia na tela onde a trilha é lida, e
 * deixou de valer: o painel da conversa muda etapa, status e etiqueta, e
 * automações (Calendly, Typebot) e colegas no Kanban movem o card com a
 * conversa aberta. A linha "Avançou de … para …" só aparecia no fio depois de
 * atualizar (pergunta do operador, 28/09/2026).
 *
 * - SÓ INSERT: a trilha só cresce (`authenticated` nem escreve nela). O evento
 *   apagado por um desfazer de carga some na próxima busca.
 * - O `token` continua refazendo a busca: o botão de atualizar da thread, a
 *   volta à aba e a reconexão do tempo real passam por ele e cobrem o que o
 *   canal perdeu enquanto esteve fora.
 * - O que sai daqui é sempre do contato do render ATUAL (`eventosDoContato`):
 *   o estado só troca de contato quando a busca nova volta, e até lá o fio do
 *   cliente B mostraria a trilha do cliente A. Pelo mesmo motivo `carregando`
 *   vale até a busca DESTE contato voltar (`buscadoDe`): sem isso, a aba
 *   Histórico dizia "sem atividade" a cada troca de cliente.
 * - O `occurred_at` do tempo real chega no mesmo formato do PostgREST (medido
 *   em 28/09/2026: `2026-09-28T18:32:49.447009+00:00`), e é isso que deixa
 *   `ordenarPorTempo` e `intercalar` compararem o texto.
 */
export function useLeadEvents(contactId: string | null | undefined, token = 0) {
  const [eventos, setEventos] = useState<LeadEvent[]>([]);
  const [carregando, setCarregando] = useState(false);
  /** De qual contato é a última busca que VOLTOU, bem ou mal. */
  const [buscadoDe, setBuscadoDe] = useState<string | null>(null);
  /**
   * Ids que chegaram pelo tempo real desde o COMEÇO da busca em curso.
   *
   * A foto da busca pode ser anterior a um evento que o canal já entregou, e
   * trocar a lista pela resposta o apagaria da tela. O evento que chegou antes
   * de a busca começar já estava gravado e está na foto dela; por isso o
   * conjunto recomeça a cada busca.
   */
  const chegadosRef = useRef<Set<string>>(new Set());

  const buscar = useCallback(
    async (vivo?: () => boolean) => {
      // `typeof`, e não `vivo ?`: quem passar `recarregar` direto a um
      // `onClick` mandaria o evento do clique no lugar da função.
      const valeAinda = () => (typeof vivo === 'function' ? vivo() : true);
      if (!contactId) {
        setEventos([]);
        return;
      }
      setCarregando(true);
      chegadosRef.current = new Set();
      const supabase = createClient();
      const { data, error } = await supabase
        .from('cb_lead_events')
        .select('*')
        .eq('contact_id', contactId)
        // Teto de segurança: um lead antigo e muito mexido não pode travar a
        // abertura da conversa. Busca as MAIS RECENTES e reordena no cliente.
        .order('occurred_at', { ascending: false })
        .limit(200);

      // Troca rápida de contato: a busca do anterior que volta por último não
      // pode sobrescrever a do atual.
      if (!valeAinda()) return;

      if (error) {
        // Falha aqui não pode derrubar a conversa: a trilha é informação
        // acessória do atendimento, e o chat precisa abrir de qualquer jeito.
        console.warn('[lead-events] falha ao buscar histórico:', error.message);
        setEventos([]);
      } else {
        const chegados = chegadosRef.current;
        setEventos((atuais) =>
          juntarEventos(
            (data ?? []) as LeadEvent[],
            atuais.filter((e) => chegados.has(e.id)),
          ),
        );
      }
      setBuscadoDe(contactId);
      setCarregando(false);
    },
    [contactId],
  );

  useEffect(() => {
    let vivo = true;
    void buscar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [buscar, token]);

  useEffect(() => {
    if (!contactId) return;
    let ativo = true;
    const supabase = createClient();
    const canal = supabase
      .channel(`trilha:${contactId}:${++canaisAbertos}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'cb_lead_events',
          filter: `contact_id=eq.${contactId}`,
        },
        (payload) => {
          // A remoção do canal é assíncrona: evento que chegue depois da troca
          // de contato não entra.
          if (!ativo) return;
          const evento = payload.new as LeadEvent;
          chegadosRef.current.add(evento.id);
          setEventos((atuais) => juntarEventos(atuais, [evento]));
        },
      )
      .subscribe();

    return () => {
      ativo = false;
      void supabase.removeChannel(canal);
    };
  }, [contactId]);

  const eventosDoContato = useMemo(
    () =>
      contactId ? eventos.filter((e) => e.contact_id === contactId) : SEM_EVENTOS,
    [eventos, contactId],
  );

  return {
    eventos: eventosDoContato,
    carregando: carregando || (!!contactId && buscadoDe !== contactId),
    recarregar: buscar,
  };
}

'use client';

// ============================================================
// As mensagens agendadas de UMA conversa (migration 925).
//
// Lê direto da tabela: a policy de SELECT já recorta por conta, e não há
// nada a compor que justifique uma rota. Escrever é que passa pelo servidor.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type { ScheduledMessage } from '@/types';

/**
 * De quanto em quanto tempo a lista se refaz ENQUANTO houver algo por sair.
 *
 * ⚠️ Só existe por causa do minuto exato: quem agendou para as 14h costuma
 * estar com a conversa aberta às 14h, olhando. Sem isto a linha ficaria
 * "Agendada" na tela depois de a mensagem já ter aparecido no fio logo
 * acima — a tela se contradizendo sozinha.
 *
 * Fila vazia não pede nada, e aba oculta também não: é o mesmo cuidado do
 * `use-channel-health`.
 */
const CICLO_MS = 30_000;

export interface Agendadas {
  agendadas: ScheduledMessage[];
  /**
   * Quando o cliente falou pela última vez nesta conversa. Serve ao aviso da
   * P4.4 — ver `clienteEscreveuDepois`. `null` = ele nunca escreveu, ou a
   * busca não respondeu.
   */
  ultimaEntradaEm: string | null;
  carregando: boolean;
  /**
   * A busca falhou. ⚠️ Precisa existir separado da lista vazia: as duas
   * pintam a mesma tela em branco, e "não há nada agendado" é uma afirmação
   * forte — quem a lê escreve uma mensagem nova achando que a antiga sumiu.
   */
  falhou: boolean;
  recarregar: () => void;
}

export function useAgendadas(conversationId: string | null): Agendadas {
  const [agendadas, setAgendadas] = useState<ScheduledMessage[]>([]);
  const [ultimaEntradaEm, setUltimaEntradaEm] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(!!conversationId);
  const [falhou, setFalhou] = useState(false);
  const vivoRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Geração da busca. Sobe a cada troca de conversa.
   *
   * ⚠️ `vivoRef` sozinho NÃO resolve a troca: o cleanup põe `false` e o
   * efeito seguinte põe `true` no MESMO commit, antes de a busca antiga
   * responder. Sem este contador, a lista do cliente A chega atrasada e se
   * pinta dentro da ficha do cliente B — com "Executar agora" e a lixeira
   * agindo sobre agendadas de OUTRO caso. E numa conversa sem fila não há
   * laço de 30s para corrigir, então o quadro errado fica até alguém trocar
   * de aba.
   */
  const geracaoRef = useRef(0);

  const buscar = useCallback(async () => {
    // ⚠️ Sai sem tocar em estado. Um `setState` síncrono aqui faria desta
    // função algo que o React Compiler recusa dentro de efeito — e o estado
    // de "sem conversa" já é resolvido no ajuste de render abaixo.
    if (!conversationId) return;
    const minhaGeracao = geracaoRef.current;
    const supabase = createClient();
    const [lista, entrada] = await Promise.all([
      supabase
        .from('cb_scheduled_messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('scheduled_for', { ascending: true }),
      // Última fala DO CLIENTE. `conversations.last_message_at` não serve:
      // ele anda com as nossas mensagens também, então a agendada marcaria
      // a si mesma como "o cliente escreveu depois".
      supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'customer')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    // Chegou tarde e a tela já é de outra conversa: descarta.
    if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;
    if (lista.error) {
      setFalhou(true);
    } else {
      setFalhou(false);
      setAgendadas((lista.data ?? []) as ScheduledMessage[]);
    }
    // O aviso é acessório: se esta busca falhar, a lista continua certa e o
    // aviso simplesmente não aparece.
    setUltimaEntradaEm(
      (entrada.data as { created_at?: string } | null)?.created_at ?? null,
    );
    setCarregando(false);
  }, [conversationId]);

  // Troca de conversa reinicia do zero. Sem isto a lista da conversa
  // anterior ficaria na tela durante a busca da nova — numa ficha de
  // cliente, mostrar mensagem marcada para OUTRO é vazamento entre casos.
  //
  // ⚠️ No RENDER, não num efeito: é o padrão "ajustar estado quando uma prop
  // muda". Dentro de `useEffect` a lista velha chega a ser pintada uma vez
  // antes da limpeza — que é justamente o quadro que não pode existir aqui —
  // e o React Compiler recusa o `setState` síncrono em efeito.
  const [convAnterior, setConvAnterior] = useState(conversationId);
  if (conversationId !== convAnterior) {
    setConvAnterior(conversationId);
    setAgendadas([]);
    setUltimaEntradaEm(null);
    // Sem conversa não há o que carregar — deixar `true` prenderia a seção
    // em "Carregando…" para sempre.
    setCarregando(!!conversationId);
    setFalhou(false);
  }

  useEffect(() => {
    vivoRef.current = true;
    geracaoRef.current += 1;
    // Assíncrona declarada aqui dentro, mesma forma do `use-channel-health`.
    // Chamando `buscar` direto, o React Compiler acusa escrita síncrona de
    // estado dentro do efeito — o que não acontece de fato (toda escrita do
    // `buscar` vem depois de um `await`), mas a regra só enxerga um nível.
    const primeira = async () => {
      await buscar();
    };
    void primeira();
    return () => {
      vivoRef.current = false;
    };
  }, [buscar]);

  // Laço só enquanto houver algo por sair.
  const temFila = agendadas.some(
    (a) => a.status === 'pending' || a.status === 'sending',
  );
  useEffect(() => {
    if (!temFila) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void buscar();
      timerRef.current = setTimeout(tick, CICLO_MS);
    };
    timerRef.current = setTimeout(tick, CICLO_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [temFila, buscar]);

  // Voltar para a aba é o momento em que o dado velho mais engana.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void buscar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);
    return () => {
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [buscar]);

  const recarregar = useCallback(() => {
    void buscar();
  }, [buscar]);

  return { agendadas, ultimaEntradaEm, carregando, falhou, recarregar };
}

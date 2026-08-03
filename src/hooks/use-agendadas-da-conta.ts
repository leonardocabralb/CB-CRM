'use client';

// ============================================================
// As mensagens agendadas da CONTA INTEIRA (Fase C).
//
// Irmão do `use-agendadas`, que faz o mesmo para uma conversa só. Lê direto da
// tabela pelo mesmo motivo: a policy de SELECT já recorta por conta e não há
// nada a compor que justifique uma rota.
//
// ⚠️ SÃO TRÊS CONSULTAS, E NÃO UMA — a razão é a única decisão de peso deste
// arquivo. A tela mostra duas coisas com ordens OPOSTAS: a fila cresce para o
// futuro (o que sai primeiro em cima) e o acervo desce para o passado (o que
// saiu por último em cima). Numa consulta só, com um teto, o `ORDER BY` teria
// de escolher uma das duas — e a errada engoliria a outra inteira: com 60
// agendadas marcadas para o mês que vem, um teto de 50 por `scheduled_for
// DESC` devolveria SÓ fila, e o acervo sumiria da tela sem aviso.
//
// ⚠️ E SÓ UMA DELAS PAGINA. `sent` é o único grupo que cresce para sempre e o
// único que não pede nada de ninguém. Fila e falhas vêm INTEIRAS: uma falha de
// seis meses atrás continua esperando decisão humana, e é exatamente ela que
// uma paginação empurraria para fora da tela — deixando a aba "Falhas" com
// cara de resolvida.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { PAGINA } from '@/lib/scheduled/tela-global';
import type { Conversation, ScheduledMessage } from '@/types';

/**
 * Embute só o necessário para responder "para quem?" — nome do contato ou do
 * grupo. Sem etiquetas, sem contadores, sem a última mensagem: a lista pode ter
 * centenas de linhas e cada campo a mais viaja em todas elas.
 */
const SELECT_COM_CONVERSA =
  '*, conversation:conversations(id, group_id, contact:contacts(id, name, phone), group:cb_groups(id, subject, alias))';

/** A conversa como ela chega aqui — estreita de propósito. */
export type ConversaDaAgendada = Pick<
  Conversation,
  'id' | 'group_id' | 'group' | 'contact'
>;

export type AgendadaDaConta = ScheduledMessage & {
  /** `null` quando o embed não veio (conversa apagada entre a linha e a leitura). */
  conversation: ConversaDaAgendada | null;
};

/**
 * Teto defensivo para os grupos que vêm inteiros.
 *
 * ⚠️ Não é paginação — é o para-choque contra um dia em que algum caminho novo
 * despeje milhares de linhas aqui. Se ele for atingido, a tela avisa em vez de
 * cortar em silêncio, que é o que o PostgREST faria sozinho no teto dele.
 */
const TETO_COMPLETO = 200;

export interface AgendadasDaConta {
  agendadas: AgendadaDaConta[];
  carregando: boolean;
  /**
   * A busca falhou. ⚠️ Separado de "lista vazia": as duas pintam a mesma tela
   * em branco, e "não há nada agendado" é uma afirmação que faz alguém agendar
   * de novo o que já estava agendado.
   */
  falhou: boolean;
  /** O acervo tem mais do que o carregado — o botão "carregar mais" aparece. */
  temMaisEnviadas: boolean;
  /** Um dos grupos completos bateu no para-choque. */
  estourouOTeto: boolean;
  carregarMais: () => void;
  recarregar: () => void;
}

export function useAgendadasDaConta(): AgendadasDaConta {
  const [agendadas, setAgendadas] = useState<AgendadaDaConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [temMaisEnviadas, setTemMaisEnviadas] = useState(false);
  const [estourouOTeto, setEstourouOTeto] = useState(false);
  const [limiteEnviadas, setLimiteEnviadas] = useState(PAGINA);
  const vivoRef = useRef(true);
  /**
   * Geração da busca — mesma proteção do `use-agendadas`. "Carregar mais"
   * dispara uma busca nova enquanto a anterior pode estar no ar; sem o
   * contador, a resposta curta chegando depois da longa encolheria a lista de
   * volta, e o operador veria linhas SUMIREM ao pedir mais.
   */
  const geracaoRef = useRef(0);

  const buscar = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    const supabase = createClient();

    const [fila, falhas, enviadas] = await Promise.all([
      supabase
        .from('cb_scheduled_messages')
        .select(SELECT_COM_CONVERSA)
        .in('status', ['pending', 'sending'])
        .order('scheduled_for', { ascending: true })
        .limit(TETO_COMPLETO),
      supabase
        .from('cb_scheduled_messages')
        .select(SELECT_COM_CONVERSA)
        .eq('status', 'failed')
        .order('scheduled_for', { ascending: false })
        .limit(TETO_COMPLETO),
      supabase
        .from('cb_scheduled_messages')
        .select(SELECT_COM_CONVERSA)
        .eq('status', 'sent')
        .order('scheduled_for', { ascending: false })
        .limit(limiteEnviadas),
    ]);

    if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;

    // ⚠️ QUALQUER uma falhando derruba a lista inteira, de propósito. Mostrar
    // duas das três daria uma tela plausível e incompleta — pior que uma tela
    // que assume não saber, porque ninguém desconfia dela.
    const erro = fila.error ?? falhas.error ?? enviadas.error;
    if (erro) {
      console.error('Falha ao carregar as agendadas da conta:', {
        message: erro.message,
        details: erro.details,
        hint: erro.hint,
        code: erro.code,
      });
      setFalhou(true);
      setCarregando(false);
      return;
    }

    const linhasFila = (fila.data ?? []) as unknown as AgendadaDaConta[];
    const linhasFalhas = (falhas.data ?? []) as unknown as AgendadaDaConta[];
    const linhasEnviadas = (enviadas.data ?? []) as unknown as AgendadaDaConta[];

    setFalhou(false);
    setAgendadas([...linhasFila, ...linhasFalhas, ...linhasEnviadas]);
    setTemMaisEnviadas(linhasEnviadas.length >= limiteEnviadas);
    setEstourouOTeto(
      linhasFila.length >= TETO_COMPLETO || linhasFalhas.length >= TETO_COMPLETO,
    );
    setCarregando(false);
  }, [limiteEnviadas]);

  useEffect(() => {
    vivoRef.current = true;
    // Assíncrona declarada aqui dentro, como no `use-agendadas`: chamando
    // `buscar` direto, o React Compiler acusa escrita síncrona de estado dentro
    // do efeito — o que não acontece de fato (toda escrita vem depois de um
    // `await`), mas a regra só enxerga um nível.
    const primeira = async () => {
      await buscar();
    };
    void primeira();
    return () => {
      vivoRef.current = false;
    };
  }, [buscar]);

  // Voltar para a aba é o momento em que o dado velho mais engana — aqui mais
  // do que na faixa, porque esta tela é justamente a que alguém deixa aberta
  // para "ficar de olho no que vai sair".
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

  const carregarMais = useCallback(() => {
    setLimiteEnviadas((n) => n + PAGINA);
  }, []);

  const recarregar = useCallback(() => {
    void buscar();
  }, [buscar]);

  return {
    agendadas,
    carregando,
    falhou,
    temMaisEnviadas,
    estourouOTeto,
    carregarMais,
    recarregar,
  };
}

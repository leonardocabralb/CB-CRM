'use client';

// ============================================================
// A saúde do agendador, para o cabeçalho.
//
// ⚠️ Lê o batimento (927) e conta a fila desta conta. É a única forma de o
// operador descobrir que o agendador parou SEM abrir o banco — e a decisão do
// escritório foi justamente não depender de ninguém para isso.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import {
  avaliarAgendador,
  type SaudeDoAgendador,
} from '@/lib/scheduled/saude';

/**
 * De quanto em quanto tempo a tela reconfere.
 *
 * Bem mais espaçado que o ciclo do agendador (15 min): o estado muda devagar,
 * e o custo aqui é duas contagens por aba aberta. Aba oculta não pede nada.
 */
const RECONFERIR_MS = 5 * 60_000;

export interface SaudeDoAgendadorNaTela {
  saude: SaudeDoAgendador | null;
  /**
   * Reconfere agora.
   *
   * ⚠️ Existe porque este hook tem estado PRÓPRIO e cadência própria (5 min).
   * Quem AGE sobre uma agendada — cancelar a última que falhou, por exemplo —
   * muda os números que ele conta, e sem uma recarga a mesma tela passaria a
   * afirmar duas coisas contrárias: a lista sem nenhuma falha e esta faixa
   * dizendo que há uma esperando decisão.
   */
  recarregar: () => void;
}

export function useAgendadorSaude(): SaudeDoAgendadorNaTela {
  const [saude, setSaude] = useState<SaudeDoAgendador | null>(null);
  const vivoRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback(async () => {
    const supabase = createClient();
    const [batimento, pendentes, falhas] = await Promise.all([
      supabase
        .from('cb_agendador_batimento')
        .select('ultimo_ciclo, ultimo_ciclo_automacoes')
        .maybeSingle(),
      // ⚠️ `head: true` + `count`: só o número volta, sem trazer linha nenhuma.
      // A RLS já recorta por conta, então isto é a fila DESTA conta.
      //
      // ⚠️ `pending` E `sending`, a mesma definição de fila que o `estaNaFila`
      // usa na tela. Contando só `pending`, uma linha travada em `sending` — o
      // worker morreu no meio do envio — fazia esta faixa dizer "não há nada na
      // fila agora" logo acima de uma aba "Fila 1" com a linha travada dentro.
      // E é justamente a linha travada que precisa de gente.
      supabase
        .from('cb_scheduled_messages')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'sending']),
      supabase
        .from('cb_scheduled_messages')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'failed'),
    ]);

    if (!vivoRef.current) return;

    // ⚠️ Contagem que FALHOU não pode virar zero. `count` vem nulo tanto em
    // "não há nenhuma" quanto em "a consulta deu erro", e tratar os dois igual
    // faria a fila sumir do cálculo — o vermelho de "há mensagem que não vai
    // sair" viraria âmbar de "nada em risco", que é a mentira que este
    // indicador existe para desfazer. Sem número confiável, mantém o anterior.
    const contar = (
      r: { count: number | null; error: unknown },
      anterior: number,
    ) => (r.error ? anterior : (r.count ?? 0));

    setSaude((antes) =>
      avaliarAgendador({
        ultimoCiclo: batimento.error
          ? // Batimento ilegível cai em `nuncaRodou`, que ACENDE. É o lado
            // seguro: silenciar aqui esconderia um agendador morto.
            null
          : ((batimento.data as { ultimo_ciclo?: string } | null)
              ?.ultimo_ciclo ?? null),
        // Laço rápido (937). ⚠️ `undefined` quando a leitura falhou, e é
        // proposital: neste caso o `ultimoCiclo` acima já vira `null` e
        // acende sozinho. Mandar `null` aqui TAMBÉM acenderia um segundo
        // alarme pelo mesmo motivo, e a tela passaria a acusar o laço rápido
        // com base em nada — o operador iria caçar um defeito que não existe.
        ultimoCicloAutomacoes: batimento.error
          ? undefined
          : ((batimento.data as { ultimo_ciclo_automacoes?: string } | null)
              ?.ultimo_ciclo_automacoes ?? null),
        pendentes: contar(pendentes, antes?.pendentes ?? 0),
        falhas: contar(falhas, antes?.falhas ?? 0),
      }),
    );
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    const primeira = async () => {
      await buscar();
    };
    void primeira();

    const agendar = () => {
      timerRef.current = setTimeout(tick, RECONFERIR_MS);
    };
    const tick = async () => {
      if (document.visibilityState === 'visible') await buscar();
      if (vivoRef.current) agendar();
    };
    agendar();

    // Voltar para a aba é quando o dado velho mais engana.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void buscar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);

    return () => {
      vivoRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [buscar]);

  const recarregar = useCallback(() => {
    void buscar();
  }, [buscar]);

  return { saude, recarregar };
}

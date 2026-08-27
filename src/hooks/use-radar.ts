'use client';

// ============================================================
// Os insights do Radar da conta inteira, lidos DIRETO da tabela — a
// policy de SELECT da 941 recorta por conta e não há nada a compor que
// justifique uma rota (mesmo racional do use-agendadas-da-conta).
//
// As AÇÕES (tratar/descartar/reanalisar) são a exceção: passam pela API,
// porque `authenticated` não tem UPDATE na tabela (de propósito — ver a
// 941) e porque reanalisar dispara gasto de IA que exige papel.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import type {
  EstadoDoInsight,
  Urgencia,
} from '@/lib/cb-radar/ordenacao';
import type { Evidencia } from '@/lib/cb-radar/rubrica';

/** O JSON gravado em `detalhes` pelo worker. */
export interface DetalhesDoInsight {
  sem_ia?: boolean;
  processos?: string[];
  analise?: {
    urgenciaMotivo?: string;
    urgenciaEvidencias?: Evidencia[];
    insatisfacaoMotivo?: string;
    insatisfacaoEvidencias?: Evidencia[];
    pedidosNaoAtendidos?: { pedido: string; evidencias: Evidencia[] }[];
    mencaoProcessoEvidencias?: Evidencia[];
    pontosDeAtencao?: { titulo: string; detalhe: string; evidencias: Evidencia[] }[];
    sinaisDescartados?: number;
  } | null;
}

export interface InsightDaConta {
  id: string;
  conversation_id: string;
  channel_id: string | null;
  janela_fim: string | null;
  mensagens_analisadas: number;
  mensagens_sem_texto: number;
  nota: number | null;
  urgencia: Urgencia;
  insatisfacao: boolean;
  mencao_processo: boolean;
  pedidos_abertos: number;
  resumo: string | null;
  detalhes: DetalhesDoInsight | null;
  primeira_resposta_seg: number | null;
  resposta_mediana_seg: number | null;
  aguardando_desde: string | null;
  estado: EstadoDoInsight;
  status: string;
  erro: string | null;
  analisado_em: string | null;
  conversation: {
    id: string;
    last_message_at: string | null;
    contact: { id: string; name: string | null; phone: string | null } | null;
  } | null;
}

const SELECT_COM_CONVERSA =
  '*, conversation:conversations(id, last_message_at, contact:contacts(id, name, phone))';

/** Para-choque, não paginação — se bater, a tela avisa (padrão agendadas). */
const TETO = 200;

export interface RadarDaConta {
  insights: InsightDaConta[];
  carregando: boolean;
  /** Separado de "vazio": tela em branco por falha não pode afirmar
   *  "está tudo tratado". */
  falhou: boolean;
  estourouOTeto: boolean;
  recarregar: () => void;
}

export function useRadar(): RadarDaConta {
  const [insights, setInsights] = useState<InsightDaConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [estourouOTeto, setEstourouOTeto] = useState(false);
  const vivoRef = useRef(true);
  const geracaoRef = useRef(0);

  const buscar = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    const supabase = createClient();

    const { data, error, count } = await supabase
      .from('cb_conversation_insights')
      .select(SELECT_COM_CONVERSA, { count: 'exact' })
      .order('analisado_em', { ascending: false, nullsFirst: false })
      .limit(TETO);

    if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;

    if (error) {
      console.error('Falha ao carregar o Radar:', {
        message: error.message,
        details: error.details,
        code: error.code,
      });
      setFalhou(true);
      setCarregando(false);
      return;
    }

    const linhas = (data ?? []) as unknown as InsightDaConta[];
    setFalhou(false);
    setInsights(linhas);
    setEstourouOTeto(linhas.length < (count ?? linhas.length));
    setCarregando(false);
  }, []);

  useEffect(() => {
    vivoRef.current = true;
    const primeira = async () => {
      await buscar();
    };
    void primeira();
    return () => {
      vivoRef.current = false;
    };
  }, [buscar]);

  // Painel que fica aberto "de olho" — voltar para a aba é quando o dado
  // velho mais engana.
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

  return { insights, carregando, falhou, estourouOTeto, recarregar };
}

// ------------------------------------------------------------
// Ações — moram no hook (não na tela) para que uma segunda superfície
// futura (a ficha do contato, por exemplo) não duplique as guardas.
// ------------------------------------------------------------

export interface AcoesDoRadar {
  /** Conversa com ação em andamento (desabilita os botões da linha). */
  ocupada: string | null;
  mudarEstado: (
    conversationId: string,
    estado: EstadoDoInsight,
  ) => Promise<{ ok: boolean; erro?: string }>;
  reanalisar: (conversationId: string) => Promise<{ ok: boolean; erro?: string }>;
}

export function useAcoesDoRadar(aoConcluir: () => void): AcoesDoRadar {
  const [ocupada, setOcupada] = useState<string | null>(null);

  const chamar = useCallback(
    async (conversationId: string, req: () => Promise<Response>) => {
      setOcupada(conversationId);
      try {
        const res = await req();
        const corpo = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!res.ok) {
          return { ok: false, erro: corpo?.error ?? `HTTP ${res.status}` };
        }
        aoConcluir();
        return { ok: true };
      } catch {
        return { ok: false, erro: 'network' };
      } finally {
        setOcupada(null);
      }
    },
    [aoConcluir],
  );

  const mudarEstado = useCallback(
    (conversationId: string, estado: EstadoDoInsight) =>
      chamar(conversationId, () =>
        fetch(`/api/cb/radar/${conversationId}/estado`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estado }),
        }),
      ),
    [chamar],
  );

  const reanalisar = useCallback(
    (conversationId: string) =>
      chamar(conversationId, () =>
        fetch(`/api/cb/radar/${conversationId}/reanalisar`, { method: 'POST' }),
      ),
    [chamar],
  );

  return { ocupada, mudarEstado, reanalisar };
}

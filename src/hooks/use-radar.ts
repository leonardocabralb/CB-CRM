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

import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type {
  EstadoDoInsight,
  Urgencia,
} from '@/lib/cb-radar/ordenacao';
import type { AnaliseInterpretada } from '@/lib/cb-radar/rubrica';

/** O JSON gravado em `detalhes` pelo worker. `analise` é o MESMO tipo
 *  que o parser da rubrica devolve — redeclarar os campos aqui fazia um
 *  sinal novo ser gravado pelo worker e nunca aparecer na tela, sem o
 *  TypeScript acusar nada. */
export interface DetalhesDoInsight {
  sem_ia?: boolean;
  /** Janela sem NENHUMA mensagem do cliente (broadcast, abordagem ativa)
   *  — a IA foi dispensada de propósito; não é falha nem falta de chave. */
  sem_cliente_na_janela?: boolean;
  janela_cortada?: boolean;
  processos?: string[];
  analise?: AnaliseInterpretada | null;
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
  /**
   * `cb_agendador_batimento.ultimo_ciclo_radar` (941). O epoch semeado
   * significa "o ciclo NUNCA rodou" — é o que deixa a tela dizer "o
   * agendador não está batendo aqui" em vez de um vazio genérico.
   * `undefined` = a leitura falhou/não voltou (não afirmar nada).
   */
  ultimoCicloRadar: string | undefined;
  /**
   * Conversas cuja pendência JÁ foi respondida por gente, conferido ao
   * vivo contra `messages` — ver `respostasDepoisDaPendencia`. A tela
   * zera a espera destas, e o cartão que existia só por causa dela sai
   * da lista na hora, sem esperar o worker.
   */
  respondidas: Set<string>;
  recarregar: () => void;
}

/** Para-choque da conferência ao vivo (mesmo espírito do `TETO` acima). */
const TETO_RESPOSTAS = 1000;

/**
 * Quais pendências a equipe JÁ respondeu — a pergunta que o campo
 * gravado não sabe responder.
 *
 * ⚠️ `aguardando_desde` é um retrato da última análise. Entre a resposta
 * do atendente e a próxima passada do worker somam-se dois atrasos (o
 * ciclo do agendador e o throttle de reanálise): até lá o cartão ficava
 * na tela com o contador "aguardando há 25h… 26h…" CRESCENDO sobre um
 * cliente que já tinha sido atendido. Uma consulta a `messages` responde
 * isso de graça e na hora.
 *
 * ⚠️ SÓ resposta de GENTE fecha a pendência (`sender_type='agent'` COM
 * `sender_id`) — a mesma regra do worker. Broadcast, automação, fluxo e
 * mensagem agendada saem com `sender_id` nulo; se qualquer saída contasse,
 * um "recebemos seu contato" automático apagaria da tela justamente o
 * cliente esquecido que o Radar existe para achar.
 */
async function respostasDepoisDaPendencia(
  supabase: ReturnType<typeof createClient>,
  linhas: InsightDaConta[],
): Promise<Set<string>> {
  const vazio = new Set<string>();
  const comPendencia = linhas.filter(
    (i): i is InsightDaConta & { aguardando_desde: string } =>
      i.aguardando_desde !== null && i.estado === 'aberto',
  );
  if (comPendencia.length === 0) return vazio;

  // Uma consulta só, recortada pela pendência MAIS ANTIGA da tela.
  // ⚠️ Comparação por INSTANTE, nunca lexicográfica: os dois lados são
  // ISO do PostgREST hoje, mas `aguardando_desde` nasce de um
  // `.toISOString()` do worker e basta um dos formatos ganhar um offset
  // (`+00:00` vs `Z`) para a ordem por string silenciosamente inverter.
  const desde = comPendencia.reduce(
    (min, i) => (Date.parse(i.aguardando_desde) < Date.parse(min) ? i.aguardando_desde : min),
    comPendencia[0].aguardando_desde,
  );
  const { data, error } = await supabase
    .from('messages')
    .select('conversation_id, created_at')
    .in(
      'conversation_id',
      comPendencia.map((i) => i.conversation_id),
    )
    .eq('sender_type', 'agent')
    .not('sender_id', 'is', null)
    .gte('created_at', desde)
    .order('created_at', { ascending: false })
    .limit(TETO_RESPOSTAS);

  // Na dúvida, MANTÉM o alarme. Falha de rede não pode apagar da tela um
  // cliente sem resposta — errar para o lado do alarme é barulho; errar
  // para o outro é o cliente esquecido sumindo em silêncio. Vale também
  // para o teto: com a lista truncada não dá para afirmar quem respondeu.
  if (error || !data) return vazio;
  if (data.length >= TETO_RESPOSTAS) {
    console.warn('[radar] conferência de pendências truncada — alarmes mantidos');
    return vazio;
  }

  const ultimaRespostaHumana = new Map<string, number>();
  for (const m of data as { conversation_id: string; created_at: string }[]) {
    const quando = Date.parse(m.created_at);
    if (Number.isNaN(quando)) continue;
    const atual = ultimaRespostaHumana.get(m.conversation_id);
    if (atual === undefined || quando > atual) {
      ultimaRespostaHumana.set(m.conversation_id, quando);
    }
  }

  const respondidas = new Set<string>();
  for (const i of comPendencia) {
    const resposta = ultimaRespostaHumana.get(i.conversation_id);
    if (resposta !== undefined && resposta > Date.parse(i.aguardando_desde)) {
      respondidas.add(i.conversation_id);
    }
  }
  return respondidas;
}

export function useRadar(): RadarDaConta {
  const { accountId } = useAuth();
  const [insights, setInsights] = useState<InsightDaConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [estourouOTeto, setEstourouOTeto] = useState(false);
  const [ultimoCicloRadar, setUltimoCicloRadar] = useState<string | undefined>(undefined);
  const [respondidas, setRespondidas] = useState<Set<string>>(() => new Set());
  const vivoRef = useRef(true);
  const geracaoRef = useRef(0);

  const buscar = useCallback(async () => {
    if (!accountId) return;
    const minhaGeracao = ++geracaoRef.current;
    const supabase = createClient();

    const [lista, pendentes, batimento] = await Promise.all([
      supabase
        .from('cb_conversation_insights')
        .select(SELECT_COM_CONVERSA, { count: 'exact' })
        // O recorte já viria da RLS; o `.eq` explícito existe para o
        // planner usar o índice (account_id, analisado_em DESC) da 941 —
        // sem a coluna-líder na consulta ele não serve nem para o ORDER.
        .eq('account_id', accountId)
        .order('analisado_em', { ascending: false, nullsFirst: false })
        .limit(TETO),
      // ⚠️ Consulta DEDICADA às pendências abertas (revisão 2026-08-27):
      // a pendência congelada (cliente esquecido além da janela) nunca é
      // reanalisada, então seu `analisado_em` envelhece e, com o acervo
      // acima do teto, ela seria a PRIMEIRA linha a cair do SELECT
      // principal — a garantia "não expira" expiraria em silêncio. São
      // poucas linhas por construção; a mescla abaixo deduplica por id.
      supabase
        .from('cb_conversation_insights')
        .select(SELECT_COM_CONVERSA)
        .eq('account_id', accountId)
        .eq('estado', 'aberto')
        .not('aguardando_desde', 'is', null)
        .order('aguardando_desde', { ascending: true })
        .limit(100),
      supabase
        .from('cb_agendador_batimento')
        .select('ultimo_ciclo_radar')
        .eq('id', true)
        .maybeSingle(),
    ]);

    if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;

    if (lista.error) {
      console.error('Falha ao carregar o Radar:', {
        message: lista.error.message,
        details: lista.error.details,
        code: lista.error.code,
      });
      setFalhou(true);
      setCarregando(false);
      return;
    }

    const principais = (lista.data ?? []) as unknown as InsightDaConta[];
    // Best-effort como o batimento: se a consulta de pendências falhar, a
    // tela perde só a blindagem contra o teto — não a lista.
    const dePendencia = (pendentes.data ?? []) as unknown as InsightDaConta[];
    const vistos = new Set(principais.map((i) => i.id));
    const linhas = [
      ...principais,
      ...dePendencia.filter((i) => !vistos.has(i.id)),
    ];
    // Antes de publicar: quem já foi respondido. Publicar a lista primeiro
    // e corrigir depois faria o cartão resolvido aparecer e sumir na cara
    // do operador — a conferência é uma consulta curta, cabe aqui.
    const jaRespondidas = await respostasDepoisDaPendencia(supabase, linhas);
    if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;

    setFalhou(false);
    setInsights(linhas);
    setRespondidas(jaRespondidas);
    setEstourouOTeto(principais.length < (lista.count ?? principais.length));
    // Best-effort: sem o batimento a tela só perde o aviso de saúde.
    setUltimoCicloRadar(
      (batimento.data as { ultimo_ciclo_radar?: string } | null)?.ultimo_ciclo_radar,
    );
    setCarregando(false);
  }, [accountId]);

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

  return {
    insights,
    carregando,
    falhou,
    estourouOTeto,
    ultimoCicloRadar,
    respondidas,
    recarregar,
  };
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

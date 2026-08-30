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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';
import { PAGINA } from '@/lib/scheduled/tela-global';
import { useAuth } from '@/hooks/use-auth';
import { recorteDeCanais } from '@/lib/perfis/escopo';
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
  /**
   * Quantas existem em cada grupo NA CONTA — não quantas foram carregadas.
   *
   * ⚠️ Vem do `count: 'exact'` do PostgREST, que viaja no mesmo cabeçalho da
   * resposta e não custa consulta a mais. Contar em JS sobre a lista carregada
   * parecia mais simples e mentia: o grupo `sent` é paginado, então a aba
   * "Enviadas" mostraria 50 numa conta com 300 — um número com cara de total,
   * exibido numa tela que se anuncia como "tudo o que já saiu".
   */
  contagem: { todas: number; fila: number; enviadas: number; falhas: number };
  /**
   * Quando o cliente falou pela última vez, por conversa da FILA. Alimenta o
   * aviso da P4.4 (`clienteEscreveuDepois`).
   */
  ultimaEntradaPorConversa: Map<string, string>;
  /** O acervo tem mais do que o carregado — o botão "carregar mais" aparece. */
  temMaisEnviadas: boolean;
  /** Um dos grupos completos bateu no para-choque. */
  estourouOTeto: boolean;
  carregarMais: () => void;
  recarregar: () => void;
}

const SEM_CONTAGEM = { todas: 0, fila: 0, enviadas: 0, falhas: 0 };
const SEM_ENTRADAS: Map<string, string> = new Map();

export function useAgendadasDaConta(): AgendadasDaConta {
  const [agendadas, setAgendadas] = useState<AgendadaDaConta[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);
  const [contagem, setContagem] = useState(SEM_CONTAGEM);
  const [ultimaEntradaPorConversa, setUltimaEntradaPorConversa] =
    useState<Map<string, string>>(SEM_ENTRADAS);
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

  // Recorte por perfil (Fase 3): aqui ele entra NA CONSULTA, ao contrário do
  // inbox — o acervo pagina no banco, e filtrar página carregada em JS
  // mostraria menos linhas que o `count: 'exact'` promete nas abas. É seguro
  // nesta tabela porque `cb_scheduled_messages` carrega o próprio
  // `channel_id`, FIXADO no agendamento (925) — inclusive para grupo, cujo
  // canal foi resolvido por `cb_groups` na criação. `canalDaConversa()` aqui
  // seria ERRADO (regra da tela, ver CLAUDE.md). Linha sem canal (legado
  // improvável: o agendamento falha fechado) fica de fora do recorte — numa
  // tela que mostra texto de mensagem a caminho de cliente, esconder é o
  // lado certo do empate.
  const { acesso } = useAuth();
  const canaisDoRecorte = useMemo(() => recorteDeCanais(acesso), [acesso]);

  const buscar = useCallback(async () => {
    const minhaGeracao = ++geracaoRef.current;
    const supabase = createClient();

    const comRecorte = <Q extends { in(col: string, vals: string[]): Q }>(q: Q): Q =>
      canaisDoRecorte ? q.in('channel_id', canaisDoRecorte) : q;

    const [fila, falhas, enviadas] = await Promise.all([
      comRecorte(supabase
        .from('cb_scheduled_messages')
        // ⚠️ `count: 'exact'` em todas as três: é o total NA CONTA, não o
        // tamanho da página, e vem no mesmo cabeçalho da resposta — de graça.
        // É o que faz as abas contarem a verdade mesmo com o acervo paginado.
        .select(SELECT_COM_CONVERSA, { count: 'exact' })
        .in('status', ['pending', 'sending'])
        .order('scheduled_for', { ascending: true })
        .limit(TETO_COMPLETO)),
      comRecorte(supabase
        .from('cb_scheduled_messages')
        .select(SELECT_COM_CONVERSA, { count: 'exact' })
        .eq('status', 'failed')
        .order('scheduled_for', { ascending: false })
        .limit(TETO_COMPLETO)),
      comRecorte(supabase
        .from('cb_scheduled_messages')
        .select(SELECT_COM_CONVERSA, { count: 'exact' })
        .eq('status', 'sent')
        // ⚠️ Ordena por `sent_at` com `scheduled_for` de reserva: no acervo a
        // pergunta é "o que saiu por último", e `scheduled_for` responde "para
        // quando estava marcado". Depois de um "Executar agora" as duas se
        // separam de vez — uma mensagem marcada para daqui a um mês e
        // antecipada hoje apareceria no fim do acervo, um mês à frente.
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('scheduled_for', { ascending: false })
        .limit(limiteEnviadas)),
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

    const nFila = fila.count ?? linhasFila.length;
    const nFalhas = falhas.count ?? linhasFalhas.length;
    const nEnviadas = enviadas.count ?? linhasEnviadas.length;

    // ⚠️ A última fala DO CLIENTE, só das conversas que têm algo na FILA — é o
    // único grupo em que o aviso da P4.4 vale (`clienteEscreveuDepois` já
    // devolve false fora dela). Sem ele, esta tela ofereceria "Executar agora"
    // sem o aviso que a faixa da conversa dá há duas fases; e aqui pesa mais,
    // porque quem está nesta tela NÃO está vendo a conversa.
    //
    // ⚠️ Uma consulta por CONVERSA, e não uma só com `in(...)`: o que se quer é
    // o máximo por conversa, que o PostgREST não agrupa. Numa consulta única a
    // conversa mais falante encheria o limite sozinha e as outras voltariam
    // sem nada — errando para o lado silencioso, que é o de não avisar.
    // O número de consultas é o de conversas com fila, limitado pelo
    // `TETO_COMPLETO`; na prática são unidades.
    const idsDaFila = [...new Set(linhasFila.map((a) => a.conversation_id))];
    const entradas = await Promise.all(
      idsDaFila.map((id) =>
        supabase
          .from('messages')
          .select('created_at')
          .eq('conversation_id', id)
          .eq('sender_type', 'customer')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
          .then((r) => [id, (r.data as { created_at?: string } | null)?.created_at] as const),
      ),
    );

    if (!vivoRef.current || geracaoRef.current !== minhaGeracao) return;

    const mapa = new Map<string, string>();
    for (const [id, quando] of entradas) if (quando) mapa.set(id, quando);

    setFalhou(false);
    setAgendadas([...linhasFila, ...linhasFalhas, ...linhasEnviadas]);
    setContagem({
      todas: nFila + nFalhas + nEnviadas,
      fila: nFila,
      falhas: nFalhas,
      enviadas: nEnviadas,
    });
    setUltimaEntradaPorConversa(mapa);
    // ⚠️ Compara com o TOTAL do banco, nunca com o limite pedido. Com
    // `carregadas >= limite` o botão morreria no teto de 1000 linhas do
    // PostgREST: pedindo 1050 e recebendo 1000, `1000 >= 1050` é falso e o
    // resto do acervo ficaria inalcançável, em silêncio.
    setTemMaisEnviadas(linhasEnviadas.length < nEnviadas);
    // ⚠️ Compara o carregado com o TOTAL, não com o teto. Com
    // `length >= TETO_COMPLETO` a tela avisaria "há mais do que cabe" numa
    // conta com exatamente 200 na fila — todas carregadas, nada cortado. Aviso
    // que aparece sem haver o que avisar é o que treina o operador a ignorar o
    // aviso do dia em que houver.
    setEstourouOTeto(
      linhasFila.length < nFila || linhasFalhas.length < nFalhas,
    );
    setCarregando(false);
  }, [limiteEnviadas, canaisDoRecorte]);

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
    contagem,
    ultimaEntradaPorConversa,
    temMaisEnviadas,
    estourouOTeto,
    carregarMais,
    recarregar,
  };
}

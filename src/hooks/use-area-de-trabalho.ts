'use client';

// ============================================================
// Os blocos da ABA /meu-dia — o que precisa ser corrigido, as conexões, as
// notificações, as suas tarefas e a equipe (v2, 29/09/2026:
// `docs/PLANO-meu-dia-v2.md`). A agenda vem da pauta de reuniões
// (`usePautaDeReunioes`), e o cartão da ENTRADA continua em
// `use-resumo-do-dia.ts` — ninguém paga por estas consultas ao abrir o app.
//
// A disciplina é a mesma de lá:
//   · Cada bloco tem estado PRÓPRIO (carregando / falhou / pronto). Nunca
//     "0" sem resposta — um zero de carga no bloco de correções vira "tudo em
//     ordem" sobre uma mensagem que não saiu.
//   · O resultado é CARIMBADO com a chave do pedido; pedido novo não vê
//     resultado velho.
//   · O relógio é lido UMA vez, dentro do efeito (`Date.now()` no render
//     reprova o React Compiler; `new Date()` passa e é o mesmo erro).
//   · Nenhum número exato sai de lista com teto: ou `count: 'exact'`, ou a
//     leitura COMPLETA, paginada por chave.
//
// ⚠️ `head: true` devolve `count` NULO tanto em erro quanto — em tese — na
// ausência de cabeçalho. Por isso o `error` é conferido ANTES, e o bloco só
// assenta como `pronto` quando a consulta deu certo.
//
// ⚠️ Todo filtro "meu" é pelo `user.id` (o id do LOGIN), ESCRITO na consulta:
// em `cb_tasks` e `conversations` a RLS deixa a conta inteira ler tudo.
// ============================================================

import { useEffect, useState } from 'react';

import { startOfLocalDay } from '@/lib/dashboard/date-utils';
import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type { ConversaDaConexao } from '@/lib/meu-dia/conexoes';
import type { TarefaDaEquipe } from '@/lib/meu-dia/equipe';
import { lerRetidas, type RetidasNaTela } from '@/lib/meu-dia/retidas';
import type { AvisoComContato } from '@/lib/notifications/texto-do-aviso';
import { conversaNoEscopo, recorteDeCanais } from '@/lib/perfis/escopo';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import { diaLocal } from '@/lib/tasks/prazo';
import { createClient } from '@/lib/supabase/client';
import type { Conversation, Task } from '@/types';

/** O mínimo para `nomeDoContato` — a mesma projeção do resto do Meu dia. */
export interface ContatoDoDia {
  id: string;
  name: string | null;
  phone: string | null;
  wa_username?: string | null;
  instagram_username?: string | null;
}

const CONTATO =
  'contact:contacts(id, name, phone, wa_username, instagram_username)';

/** Quantas falhas de automação vêm nomeadas — o número vem do `count`. */
const LINHAS_LISTADAS = 5;

/** Página das leituras COMPLETAS (conexões, equipe) — o teto do PostgREST. */
const PAGINA = 1000;

/**
 * Para-choque das leituras completas: 50 páginas. Acima disso a leitura
 * FALHA à vista, em vez de parar no meio e afirmar um número menor.
 */
const PAGINAS_NO_MAXIMO = 50;

/** Tarefas por grupo que vêm como LINHA — o número vem do `count`. */
const LINHAS_DE_TAREFA = 50;

/** Avisos não lidos que vêm como linha. */
const TETO_DE_AVISOS = 50;

/** Teto de UUIDs por `.in()` — o PostgREST trava perto de mil valores na URL. */
const IDS_POR_CONSULTA = 500;

/** Uma automação que falhou hoje, com onde ir consertar. */
export interface FalhaDeAutomacao {
  /** O id do log — chave de render, e o que o histórico da automação mostra. */
  id: string;
  automacao: string | null;
  contato: ContatoDoDia | null;
  /**
   * A conversa do contato, quando ele tem uma.
   *
   * ⚠️ DERIVADA do contato numa consulta própria, nunca coluna:
   * `automation_logs` não guarda conversa, e a régua da casa é a UNIQUE da
   * 036 (uma conversa por contato por conta). Sem conversa, a tela cai na
   * ficha — é o mesmo caminho das tarefas.
   */
  conversationId: string | null;
}

export interface Correcoes {
  /**
   * Falhou e NÃO é entrega incerta — o que dá para reenviar.
   *
   * ⚠️ As duas contagens são DISJUNTAS de propósito: `entrega_incerta` vem
   * sempre junto de `failed` (926 — o envio estourou depois de o WhatsApp
   * aceitar), então somá-las cruas contaria a mesma linha duas vezes. E a
   * separação não é estética: são ações OPOSTAS. Reenviar o que falhou é
   * seguro; reenviar o incerto manda a mesma mensagem duas vezes ao cliente.
   */
  agendadasFalharam: number;
  entregaIncerta: number;
  automacoesFalharam: number;
  /**
   * As primeiras falhas, para o operador ir direto consertar. O NÚMERO
   * acima é o do banco (`count: 'exact'`); esta lista é só o começo.
   */
  falhasDeAutomacao: FalhaDeAutomacao[];
}

export interface Integracoes {
  calendly: number;
  webhooks: number;
  /**
   * ⚠️ `null` = "não consegui conferir" — a rota não respondeu esta parte
   * (banco sem a 1010, erro só desta consulta, servidor antigo no meio de um
   * deploy). NUNCA zero: zero afirmaria "nenhuma mensagem retida".
   */
  retidas: RetidasNaTela | null;
}

export interface Conexoes {
  /**
   * As conversas 1:1 ativas que têm algo a contar (não lida ou esperando),
   * da conta INTEIRA. A conta por conexão é da tela (`contarPorConexao`),
   * que conhece as conexões do perfil.
   */
  conversas: ConversaDaConexao[];
}

export interface Notificacoes {
  /** As não lidas NO ESCOPO do perfil, a mais nova primeiro. */
  avisos: AvisoComContato[];
  /** Não lidas de conversas em conexões FORA do perfil — só contadas. */
  foraDoPerfil: number;
  /** Havia mais não lidas que `TETO_DE_AVISOS`: o número é um piso. */
  truncada: boolean;
}

export type TarefaDoDia = Task & {
  contact: ContatoDoDia | null;
  /** A conversa do cliente, DERIVADA (a tarefa não guarda conversa). */
  conversation_id: string | null;
};

export interface TarefasDoDia {
  /** Até `LINHAS_DE_TAREFA` de cada grupo, a mais antiga primeiro. */
  vencidas: TarefaDoDia[];
  hoje: TarefaDoDia[];
  /** Recebidas e ainda não vistas, com prazo DEPOIS de hoje. */
  novas: TarefaDoDia[];
  /** Os TOTAIS, do `count: 'exact'` — são estes que a tela afirma. */
  totais: { vencidas: number; hoje: number; novas: number };
}

export interface Equipe {
  /** As tarefas ABERTAS com prazo até hoje, da conta inteira, completas. */
  tarefas: (TarefaDaEquipe & { conversation_id: string | null })[];
}

export interface AreaDeTrabalho {
  agoraMs: number;
  correcoes: Bloco<Correcoes>;
  integracoes: Bloco<Integracoes>;
  conexoes: Bloco<Conexoes>;
  notificacoes: Bloco<Notificacoes>;
  tarefas: Bloco<TarefasDoDia>;
  /** Só com `comEquipe`; sem ele fica em "carregando" e a tela não o lê. */
  equipe: Bloco<Equipe>;
}

const CARREGANDO = { status: 'carregando' } as const;
const FALHOU = { status: 'falhou' } as const;

const VAZIA: AreaDeTrabalho = {
  agoraMs: 0,
  correcoes: CARREGANDO,
  integracoes: CARREGANDO,
  conexoes: CARREGANDO,
  notificacoes: CARREGANDO,
  tarefas: CARREGANDO,
  equipe: CARREGANDO,
};

const linhas = <T>(data: unknown): T[] => (data ?? []) as T[];

export interface PedidoDaArea {
  userId: string;
  accountId: string;
  /** A LENTE do "Ver como" — esta aba vive dentro do app. */
  ctx: ContextoDeAcesso;
  /** Busca as tarefas da equipe (o card só de admin e de quem vê o Painel). */
  comEquipe: boolean;
  /** Muda para consultar de novo (o "Atualizar"). */
  versao?: number;
}

function chaveDoPedido(p: PedidoDaArea): string {
  return [
    p.userId,
    p.accountId,
    p.ctx.papel ?? '',
    p.ctx.perfil?.id ?? '',
    p.comEquipe ? 'equipe' : '',
    p.versao ?? 0,
  ].join('|');
}

type Supabase = ReturnType<typeof createClient>;

/**
 * A conversa de cada contato, numa consulta por fatia. Uma conversa por
 * contato por conta (UNIQUE da 036); grupo não tem contato.
 */
async function conversaPorContato(
  supabase: Supabase,
  accountId: string,
  contatos: readonly string[],
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const ids = [...new Set(contatos)];
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('account_id', accountId)
      .in('contact_id', ids.slice(i, i + IDS_POR_CONSULTA));
    if (error) throw new Error(error.message);
    for (const c of linhas<{ id: string; contact_id: string | null }>(data)) {
      if (c.contact_id) mapa.set(c.contact_id, c.id);
    }
  }
  return mapa;
}

export function useAreaDeTrabalho(pedido: PedidoDaArea): AreaDeTrabalho {
  const { userId, accountId, ctx, comEquipe } = pedido;
  const chave = chaveDoPedido(pedido);
  const [estado, setEstado] = useState<{ chave: string; area: AreaDeTrabalho }>(
    () => ({ chave, area: VAZIA })
  );

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    const agora = new Date();
    const agoraMs = agora.getTime();
    // O dia de QUEM LÊ (`startOfLocalDay`/`diaLocal`), o mesmo do Painel e da
    // régua de prazo das tarefas: "hoje" é uma pergunta sobre o dia da pessoa.
    const inicioDoDia = startOfLocalDay(agora).toISOString();
    const hoje = diaLocal(agora);
    const canais = recorteDeCanais(ctx);

    const assentar = <K extends keyof Omit<AreaDeTrabalho, 'agoraMs'>>(
      bloco: K,
      valor: AreaDeTrabalho[K]
    ) => {
      if (!vivo) return;
      setEstado((e) => {
        const base = e.chave === chave ? e.area : VAZIA;
        return { chave, area: { ...base, agoraMs, [bloco]: valor } };
      });
    };

    const carregar = <K extends keyof Omit<AreaDeTrabalho, 'agoraMs'>>(
      bloco: K,
      consulta: () => Promise<
        Extract<AreaDeTrabalho[K], { status: 'pronto' }>['dados']
      >
    ) => {
      void (async () => {
        try {
          const dados = await consulta();
          assentar(bloco, { status: 'pronto', dados } as AreaDeTrabalho[K]);
        } catch (e) {
          console.error(
            `[useAreaDeTrabalho] ${bloco}:`,
            e instanceof Error ? e.message : e
          );
          assentar(bloco, FALHOU);
        }
      })();
    };

    carregar('correcoes', async () => {
      // ⚠️ O recorte por conexão vai NA CONSULTA aqui, e isso só é seguro
      // porque `cb_scheduled_messages` carrega o próprio `channel_id`,
      // fixado no agendamento (925). Em `conversations` seria errado — lá o
      // canal do grupo mora noutra tabela.
      const agendadas = () => {
        const q = supabase
          .from('cb_scheduled_messages')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', accountId)
          .eq('status', 'failed');
        return canais ? q.in('channel_id', canais) : q;
      };
      const [falharam, incertas, automacoes] = await Promise.all([
        agendadas().eq('entrega_incerta', false),
        agendadas().eq('entrega_incerta', true),
        // ⚠️⚠️ `desfecho`, NUNCA `status`: `automation_logs.status` nasce
        // 'failed' no INSERT, ANTES do primeiro passo (985) — filtrar por
        // ele pintaria de vermelho toda automação que apenas COMEÇOU,
        // inclusive as paradas num "Aguardar". `finalizado_em` no filtro
        // recorta o dia E garante que a execução terminou.
        //
        // ⚠️ Traz LINHA (com o nome da automação e o contato), não só o
        // `count`: sem elas o achado levava a `/automations`, uma tela
        // genérica onde o operador ainda teria de descobrir qual execução
        // falhou e de quem era. O número afirmado continua vindo do
        // `count: 'exact'`; a lista é só o começo.
        supabase
          .from('automation_logs')
          .select(`id, contact_id, automations(name), ${CONTATO}`, {
            count: 'exact',
          })
          .eq('account_id', accountId)
          .eq('desfecho', 'falhou')
          .gte('finalizado_em', inicioDoDia)
          .order('finalizado_em', { ascending: false })
          .limit(LINHAS_LISTADAS),
      ]);
      if (falharam.error) throw new Error(falharam.error.message);
      if (incertas.error) throw new Error(incertas.error.message);
      if (automacoes.error) throw new Error(automacoes.error.message);

      const logs = linhas<{
        id: string;
        contact_id: string | null;
        automations: { name: string | null } | null;
        contact: ContatoDoDia | null;
      }>(automacoes.data);

      // A conversa de cada contato. `automation_logs` não guarda conversa;
      // quem responde é a UNIQUE da 036. No máximo LINHAS_LISTADAS contatos.
      const conversas = await conversaPorContato(
        supabase,
        accountId,
        logs.map((l) => l.contact_id).filter((id): id is string => !!id)
      );

      return {
        agendadasFalharam: falharam.count ?? 0,
        entregaIncerta: incertas.count ?? 0,
        automacoesFalharam: automacoes.count ?? logs.length,
        falhasDeAutomacao: logs.map((l) => ({
          id: l.id,
          automacao: l.automations?.name ?? null,
          contato: l.contact ?? null,
          conversationId: l.contact_id
            ? (conversas.get(l.contact_id) ?? null)
            : null,
        })),
      };
    });

    carregar('integracoes', async () => {
      const r = await fetch('/api/cb/meu-dia/pendencias');
      if (!r.ok) throw new Error(`pendencias: HTTP ${r.status}`);
      const json = (await r.json()) as {
        naoProcessadas?: { calendly?: number; webhooks?: number };
        retidas?: unknown;
      };
      return {
        calendly: json.naoProcessadas?.calendly ?? 0,
        webhooks: json.naoProcessadas?.webhooks ?? 0,
        retidas: lerRetidas(json.retidas),
      };
    });

    carregar('conexoes', async () => {
      // ⚠️ Leitura COMPLETA, paginada por CHAVE (`id`): o indicador AFIRMA
      // um número, e a caixa filtrada para onde ele leva conta a lista
      // inteira. Paginar por posição com a caixa viva (conversa nova
      // entrando no meio) pularia ou repetiria linha.
      //
      // Só as linhas que contam alguma coisa (não lida OU esperando) — o
      // resto somaria zero. Grupo e encerrada ficam de fora aqui e na régua.
      const conversas: ConversaDaConexao[] = [];
      let depoisDe: string | null = null;
      for (let pagina = 0; ; pagina++) {
        if (pagina >= PAGINAS_NO_MAXIMO) {
          throw new Error('conversas demais para uma leitura');
        }
        let q = supabase
          .from('conversations')
          .select(
            'id, channel_id, status, group_id, unread_count, aguardando_desde'
          )
          .eq('account_id', accountId)
          .is('group_id', null)
          .neq('status', 'closed')
          .or('unread_count.gt.0,aguardando_desde.not.is.null')
          .order('id', { ascending: true })
          .limit(PAGINA);
        if (depoisDe) q = q.gt('id', depoisDe);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        const pag = linhas<ConversaDaConexao>(data);
        conversas.push(...pag);
        if (pag.length < PAGINA) break;
        depoisDe = pag[pag.length - 1].id;
      }
      return { conversas };
    });

    carregar('notificacoes', async () => {
      // As NÃO LIDAS (pedido do operador, 29/09: ênfase nas notificações) —
      // o que ainda pede atenção, e não o que chegou desde a última entrada
      // (isso continua no cartão da entrada).
      const { data, error, count } = await supabase
        .from('notifications')
        .select(
          'id, account_id, user_id, type, title, body, conversation_id, contact_id, task_id, actor_user_id, read_at, created_at, ' +
            'contact:contacts(name, phone, wa_username, instagram_username)',
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(TETO_DE_AVISOS);
      if (error) throw new Error(error.message);
      const avisos = linhas<AvisoComContato>(data);

      // ⚠️ O recorte por conexão do PERFIL (a régua das novidades, pedido do
      // operador de 12/09): aviso de conversa de outra conexão vira número,
      // não linha. Aviso de tarefa não tem conversa e nunca é recortado.
      // Conversa que não voltou CONTA como dentro — esconder por ignorância
      // é pior que mostrar de mais.
      const ids = [
        ...new Set(
          avisos
            .map((a) => a.conversation_id)
            .filter((id): id is string => !!id)
        ),
      ];
      const conversasPorId = new Map<string, Conversation>();
      if (ids.length > 0) {
        const { data: convs, error: erroConversas } = await supabase
          .from('conversations')
          .select('id, channel_id, group_id, group:cb_groups(channel_id)')
          .eq('account_id', accountId)
          .in('id', ids);
        if (erroConversas) throw new Error(erroConversas.message);
        for (const c of linhas<Conversation>(convs)) conversasPorId.set(c.id, c);
      }
      const dentro: AvisoComContato[] = [];
      let foraDoPerfil = 0;
      for (const a of avisos) {
        const conversa = a.conversation_id
          ? conversasPorId.get(a.conversation_id)
          : undefined;
        if (conversa && !conversaNoEscopo(ctx, conversa)) foraDoPerfil++;
        else dentro.push(a);
      }
      return {
        avisos: dentro,
        foraDoPerfil,
        truncada: (count ?? avisos.length) > avisos.length,
      };
    });

    carregar('tarefas', async () => {
      // Três grupos, cada um com o seu `count`: o número vem do banco, a
      // lista traz só o começo (mais antiga primeiro, como a tela de
      // Tarefas). Numa consulta só, ordenada por prazo e com teto, mil
      // vencidas empurrariam as de hoje para fora — e "0 vencem hoje" seria
      // mentira.
      const minhasAbertas = () =>
        supabase
          .from('cb_tasks')
          .select(`*, ${CONTATO}`, { count: 'exact' })
          .eq('account_id', accountId)
          .eq('responsavel_user_id', userId)
          .eq('status', 'aberta')
          .order('vence_em', { ascending: true })
          .order('vence_as', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: true })
          .limit(LINHAS_DE_TAREFA);
      const [vencidas, deHoje, novas] = await Promise.all([
        // A régua é o DIA de quem lê (`diaLocal`), como em /tarefas.
        minhasAbertas().lt('vence_em', hoje),
        minhasAbertas().eq('vence_em', hoje),
        // Recebida e ainda não vista (1068), de prazo futuro — as de prazo
        // até hoje já estão nos dois grupos acima.
        minhasAbertas().gt('vence_em', hoje).is('vista_em', null),
      ]);
      if (vencidas.error) throw new Error(vencidas.error.message);
      if (deHoje.error) throw new Error(deHoje.error.message);
      if (novas.error) throw new Error(novas.error.message);

      type Linha = Task & { contact: ContatoDoDia | null };
      const [v, h, n] = [vencidas, deHoje, novas].map((r) =>
        linhas<Linha>(r.data)
      );
      const conversas = await conversaPorContato(
        supabase,
        accountId,
        [...v, ...h, ...n].map((t) => t.contact_id)
      );
      const comConversa = (l: Linha[]): TarefaDoDia[] =>
        l.map((t) => ({
          ...t,
          conversation_id: conversas.get(t.contact_id) ?? null,
        }));
      return {
        vencidas: comConversa(v),
        hoje: comConversa(h),
        novas: comConversa(n),
        totais: {
          vencidas: vencidas.count ?? v.length,
          hoje: deHoje.count ?? h.length,
          novas: novas.count ?? n.length,
        },
      };
    });

    if (comEquipe)
      carregar('equipe', async () => {
        // ⚠️ COMPLETA, paginada por chave: o card compara pessoas, e uma
        // lista cortada no teto esconderia justamente quem está mais
        // atrasado (a ordem por id não tem nada a ver com prazo).
        const tarefas: TarefaDaEquipe[] = [];
        let depoisDe: string | null = null;
        for (let pagina = 0; ; pagina++) {
          if (pagina >= PAGINAS_NO_MAXIMO) {
            throw new Error('tarefas demais para uma leitura');
          }
          let q = supabase
            .from('cb_tasks')
            .select(
              `id, titulo, vence_em, vence_as, responsavel_user_id, responsavel_nome, vista_em, contact_id, ${CONTATO}`
            )
            .eq('account_id', accountId)
            .eq('status', 'aberta')
            .lte('vence_em', hoje)
            .order('id', { ascending: true })
            .limit(PAGINA);
          if (depoisDe) q = q.gt('id', depoisDe);
          const { data, error } = await q;
          if (error) throw new Error(error.message);
          const pag = linhas<TarefaDaEquipe>(data);
          tarefas.push(...pag);
          if (pag.length < PAGINA) break;
          depoisDe = pag[pag.length - 1].id;
        }
        const conversas = await conversaPorContato(
          supabase,
          accountId,
          tarefas.map((t) => t.contact_id)
        );
        return {
          tarefas: tarefas.map((t) => ({
            ...t,
            conversation_id: conversas.get(t.contact_id) ?? null,
          })),
        };
      });

    return () => {
      vivo = false;
    };
  }, [userId, accountId, ctx, comEquipe, chave]);

  return estado.chave === chave ? estado.area : VAZIA;
}

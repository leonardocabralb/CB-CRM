'use client';

// ============================================================
// As pendências do dia de UMA pessoa, para a tela de entrada (Meu dia).
//
// Consultas em paralelo, cada bloco com estado PRÓPRIO (carregando / falhou
// / pronto). ⚠️ Nunca "0" sem resposta: é a armadilha "lista vazia virando
// afirmação" do CLAUDE.md — um bloco que dissesse "0 tarefas vencidas"
// durante a carga, ou depois de uma falha, liberaria a entrada com uma
// mentira, que é o oposto do que a tela existe para fazer.
//
// ⚠️ TODO filtro "meu" é pelo id do LOGIN (`user.id` = `profiles.user_id`),
// nunca `profiles.id`: `cb_tasks.responsavel_user_id`,
// `conversations.assigned_agent_id` e `notifications.user_id` guardam
// `auth.users.id`. O id errado devolve ZERO sem dar erro. E em `cb_tasks` e
// `conversations` a RLS deixa a conta inteira ler tudo, então o recorte por
// pessoa vai ESCRITO na consulta.
//
// ⚠️ O resultado é CARIMBADO com a chave do pedido, e outro pedido nunca vê
// o resultado deste: se `desdeMs` ou o contexto mudarem com a tela montada,
// os blocos voltam a "carregando" em vez de exibir os números do pedido
// anterior como se fossem do novo (a família "{ de, mapa }" do CLAUDE.md).
//
// ⚠️ O relógio é lido UMA vez, dentro do efeito, e guardado com o resultado:
// as réguas de "hoje" das tarefas, de "10 min" das conversas e de "desde a
// última entrada" das novidades usam o MESMO instante. (`Date.now()` no
// render reprova o lint do React Compiler; `new Date()` passa e é o mesmo
// erro.)
//
// ⚠️ O recorte por conexão do perfil é feito em JS (`conversaNoEscopo`), e
// por isso o select de conversas traz `group:cb_groups(channel_id)`: filtrar
// `conversations` por canal NA CONSULTA apaga os grupos, cujo `channel_id` é
// sempre nulo (armadilha documentada em `src/lib/inbox/filtros.ts`).
//
// ⚠️ O select é ENXUTO de propósito, e não o `CONVERSATION_SELECT` do inbox
// (contato inteiro + etiquetas + grupo inteiro): a fila sem responsável tem
// centenas de linhas (235 esperando em 12/09/2026), o inbox vai buscar tudo
// de novo logo depois do "Continuar", e aqui só entram o nome do cliente e
// as colunas que as réguas leem.
//
// ⚠️ A fila sai em DUAS consultas, repartidas pelo instante da confirmação
// anterior. Numa só, ordenada por espera e com teto, quem cai primeiro é o
// FIM da lista — as esperas mais recentes, que são exatamente as "novas":
// passando do teto, a tela diria "ninguém começou a esperar" sobre gente
// que começou (a lição do Radar: "com mais linhas que o teto, quem cai é o
// começo da janela"). Cada metade leva `count: 'exact'` para o teto não
// virar um número menor com cara de certo.
// ============================================================

import { useEffect, useState } from 'react';

import type { ContatoDaTarefa } from '@/hooks/use-tarefas';
import type { ContextoDeAcesso } from '@/lib/perfis/tipos';
import {
  resumirConversas,
  resumirFila,
  resumirNovidades,
  type Novidades,
  type ResumoDaFila,
  type ResumoDasConversas,
} from '@/lib/resumo-do-dia/contagens';
import { createClient } from '@/lib/supabase/client';
import { agruparPorPrazo, diaLocal } from '@/lib/tasks/prazo';
import type { Conversation, Task } from '@/types';

export type Bloco<T> =
  | { status: 'carregando' }
  | { status: 'falhou' }
  | { status: 'pronto'; dados: T };

export type TarefaDoResumo = Task & { contact: ContatoDaTarefa | null };

export interface Tarefas {
  vencidas: TarefaDoResumo[];
  hoje: TarefaDoResumo[];
}

export interface Fila extends ResumoDaFila {
  /**
   * Alguma das duas consultas bateu no teto de linhas: os números são PELO
   * MENOS os mostrados. Com o recorte de perfil feito em JS, o `count` do
   * banco não serve de número — serve de aviso.
   */
  truncada: boolean;
}

export interface ResumoDoDia {
  /** Instante em que as consultas saíram — a régua de todos os blocos. */
  agoraMs: number;
  novidades: Bloco<Novidades>;
  tarefas: Bloco<Tarefas>;
  conversas: Bloco<ResumoDasConversas>;
  fila: Bloco<Fila>;
}

const CARREGANDO = { status: 'carregando' } as const;
const FALHOU = { status: 'falhou' } as const;

const VAZIO: ResumoDoDia = {
  agoraMs: 0,
  novidades: CARREGANDO,
  tarefas: CARREGANDO,
  conversas: CARREGANDO,
  fila: CARREGANDO,
};

/** Para-choque das consultas sem paginação (o Meu dia lista 5 e conta o resto). */
const TETO_DE_LINHAS = 1000;

/**
 * Só o que as réguas leem: `conversaNoEscopo` (canal, grupo e o canal do
 * grupo), `atrasoDeResposta` (situação, grupo, espera) e o nome do cliente.
 */
const SELECT_DE_CONVERSA =
  'id, status, assigned_agent_id, channel_id, group_id, aguardando_desde, ' +
  'contact:contacts(id, name, phone, instagram_username), group:cb_groups(channel_id)';

/** O cliente do Supabase devolve `any[]`; as colunas acima são as do tipo que as réguas pedem. */
const conversasDe = (data: unknown): Conversation[] =>
  (data ?? []) as Conversation[];

export interface PedidoDoResumo {
  userId: string;
  accountId: string;
  /** O contexto de acesso REAL da pessoa — nunca a lente do "Ver como". */
  ctx: ContextoDeAcesso;
  /** Desde quando contar novidades e fila nova (a confirmação anterior). */
  desdeMs: number;
}

function chaveDoPedido(p: PedidoDoResumo): string {
  return [
    p.userId,
    p.accountId,
    p.desdeMs,
    p.ctx.papel ?? '',
    p.ctx.perfil?.id ?? '',
  ].join('|');
}

export function useResumoDoDia(pedido: PedidoDoResumo): ResumoDoDia {
  const { userId, accountId, ctx, desdeMs } = pedido;
  const chave = chaveDoPedido(pedido);
  const [estado, setEstado] = useState<{ chave: string; resumo: ResumoDoDia }>(
    () => ({
      chave,
      resumo: VAZIO,
    })
  );

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    const agora = new Date();
    const agoraMs = agora.getTime();
    const desdeISO = new Date(desdeMs).toISOString();

    const assentar = <K extends keyof Omit<ResumoDoDia, 'agoraMs'>>(
      bloco: K,
      valor: ResumoDoDia[K]
    ) => {
      if (!vivo) return;
      setEstado((e) => {
        const base = e.chave === chave ? e.resumo : VAZIO;
        return { chave, resumo: { ...base, agoraMs, [bloco]: valor } };
      });
    };

    // Cada bloco assenta sozinho (quem responde primeiro aparece primeiro) e
    // qualquer estouro — do banco OU da conta em JS — vira "falhou" naquele
    // bloco: uma rejeição solta deixaria o bloco em "carregando" para sempre.
    const carregar = <K extends keyof Omit<ResumoDoDia, 'agoraMs'>>(
      bloco: K,
      consulta: () => Promise<
        Extract<ResumoDoDia[K], { status: 'pronto' }>['dados']
      >
    ) => {
      void (async () => {
        try {
          const dados = await consulta();
          assentar(bloco, { status: 'pronto', dados } as ResumoDoDia[K]);
        } catch (e) {
          console.error(
            `[useResumoDoDia] ${bloco}:`,
            e instanceof Error ? e.message : e
          );
          assentar(bloco, FALHOU);
        }
      })();
    };

    carregar('novidades', async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('type, created_at')
        .eq('user_id', userId)
        .eq('account_id', accountId)
        .gt('created_at', desdeISO)
        .limit(TETO_DE_LINHAS);
      if (error) throw new Error(error.message);
      return resumirNovidades(data ?? [], desdeMs);
    });

    carregar('tarefas', async () => {
      const { data, error } = await supabase
        .from('cb_tasks')
        .select('*, contact:contacts(id, name, phone, instagram_username)')
        .eq('account_id', accountId)
        .eq('responsavel_user_id', userId)
        .eq('status', 'aberta')
        // A régua é o DIA de quem lê (`diaLocal`), como em /tarefas.
        .lte('vence_em', diaLocal(agora))
        .order('vence_em', { ascending: true })
        .limit(TETO_DE_LINHAS);
      if (error) throw new Error(error.message);
      const grupos = agruparPorPrazo(
        (data ?? []) as unknown as TarefaDoResumo[],
        agora
      );
      return { vencidas: grupos.vencidas, hoje: grupos.hoje };
    });

    carregar('conversas', async () => {
      const { data, error } = await supabase
        .from('conversations')
        .select(SELECT_DE_CONVERSA)
        .eq('account_id', accountId)
        .eq('assigned_agent_id', userId)
        .neq('status', 'closed')
        .limit(TETO_DE_LINHAS);
      if (error) throw new Error(error.message);
      return resumirConversas(conversasDe(data), ctx, agoraMs);
    });

    carregar('fila', async () => {
      const semResponsavel = () =>
        supabase
          .from('conversations')
          .select(SELECT_DE_CONVERSA, { count: 'exact' })
          .eq('account_id', accountId)
          .is('assigned_agent_id', null)
          .neq('status', 'closed')
          // Grupo nunca tem `aguardando_desde` (972) e a régua o exclui de
          // qualquer jeito; filtrar aqui só poupa linhas.
          .is('group_id', null)
          .order('aguardando_desde', { ascending: true })
          .limit(TETO_DE_LINHAS);
      const [novas, antigas] = await Promise.all([
        semResponsavel().gte('aguardando_desde', desdeISO),
        semResponsavel().lt('aguardando_desde', desdeISO),
      ]);
      if (novas.error) throw new Error(novas.error.message);
      if (antigas.error) throw new Error(antigas.error.message);
      const linhasNovas = conversasDe(novas.data);
      const linhasAntigas = conversasDe(antigas.data);
      return {
        ...resumirFila(
          [...linhasNovas, ...linhasAntigas],
          ctx,
          agoraMs,
          desdeMs
        ),
        truncada:
          (novas.count ?? linhasNovas.length) > linhasNovas.length ||
          (antigas.count ?? linhasAntigas.length) > linhasAntigas.length,
      };
    });

    return () => {
      vivo = false;
    };
  }, [userId, accountId, ctx, desdeMs, chave]);

  return estado.chave === chave ? estado.resumo : VAZIO;
}

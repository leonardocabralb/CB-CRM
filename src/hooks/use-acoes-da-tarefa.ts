'use client';

// ============================================================
// As ações de uma tarefa, num lugar só (migration 944).
//
// ⚠️ MORA NUM HOOK, e não dentro da tela, pela mesma razão que as ações da
// agendada: elas são usadas em TRÊS lugares (a página `/tarefas`, a aba da
// ficha do cliente e a seção da conversa) e todas escrevem no banco. Três
// cópias divergindo nas guardas é o jeito mais silencioso de errar isto.
//
// ⚠️ TUDO PASSA PELA API. Nenhuma escrita sai daqui direto para o Supabase —
// `cb_tasks` não tem policy de escrita e o privilégio foi revogado, então um
// `.update()` daqui voltaria 42501. Quem decide se a ação é permitida é
// `podeNaTarefa`, no servidor; a tela usa a MESMA função só para desabilitar
// o botão antes.
// ============================================================

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import type { Task } from '@/types';

/** Os campos que a edição aceita. Ausente = não mexe. */
export interface EdicaoDeTarefa {
  titulo?: string;
  descricao?: string | null;
  vence_em?: string;
  vence_as?: string | null;
  responsavel_user_id?: string;
}

/** O que o formulário manda para criar. */
export interface NovaTarefa {
  contact_id?: string;
  responsavel_user_id?: string;
  titulo: string;
  descricao?: string | null;
  vence_em: string;
  vence_as?: string | null;
  importante?: boolean;
  tarefa_pai_id?: string;
  tipo?: 'tarefa' | 'resposta';
}

export interface AcoesDaTarefa {
  /** Id da tarefa com ação em curso, ou `null`. Desabilita os botões dela. */
  ocupada: string | null;
  /** `true` enquanto uma criação está em voo (não tem id ainda). */
  criando: boolean;
  criar: (nova: NovaTarefa) => Promise<Task | null>;
  marcarLida: (t: Task, lida: boolean) => Promise<void>;
  concluir: (t: Task, concluida: boolean) => Promise<void>;
  marcarImportante: (t: Task, importante: boolean) => Promise<void>;
  editar: (t: Task, campos: EdicaoDeTarefa) => Promise<void>;
  apagar: (t: Task) => Promise<void>;
}

/**
 * @param aoMudar Chamado depois de cada ação, com sucesso ou não — é o que
 *   refaz a lista de quem chamou. Sempre chamado, inclusive na falha: o estado
 *   da tela pode ter ficado adiantado em relação ao banco.
 */
export function useAcoesDaTarefa(aoMudar: () => void): AcoesDaTarefa {
  const t = useTranslations('Tasks');
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  const patch = useCallback(
    async (tarefa: Task, corpo: Record<string, unknown>, erroPadrao: string) => {
      setOcupada(tarefa.id);
      try {
        const res = await fetch(`/api/cb/tasks/${tarefa.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(corpo),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          avisado?: boolean;
        };
        if (!res.ok) {
          toast.error(json.error ?? erroPadrao);
          return;
        }
        // ⚠️ A ação deu certo E o aviso falhou. Ficar calado aqui deixaria
        // quem redirecionou a tarefa supondo que a pessoa nova foi chamada.
        if (json.avisado === false) toast.warning(t('savedButNotNotified'));
      } catch {
        toast.error(erroPadrao);
      } finally {
        setOcupada(null);
        aoMudar();
      }
    },
    [t, aoMudar],
  );

  const criar = useCallback(
    async (nova: NovaTarefa): Promise<Task | null> => {
      setCriando(true);
      try {
        const res = await fetch('/api/cb/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nova),
        });
        const json = (await res.json().catch(() => ({}))) as {
          task?: Task;
          error?: string;
          avisado?: boolean;
        };
        if (!res.ok) {
          // ⚠️ O 409 do servidor é um caso REAL, não erro de quem clicou:
          // quem pediu a tarefa saiu do escritório e não há para onde
          // responder. Traduzido, porque `PARENT_CREATOR_GONE` na tela não
          // diz nada a ninguém.
          toast.error(
            json.error === 'PARENT_CREATOR_GONE'
              ? t('replyCreatorGone')
              : (json.error ?? t('createFailed')),
          );
          return null;
        }
        if (json.avisado === false) toast.warning(t('savedButNotNotified'));
        else toast.success(t('created'));
        return json.task ?? null;
      } catch {
        toast.error(t('createFailed'));
        return null;
      } finally {
        setCriando(false);
        aoMudar();
      }
    },
    [t, aoMudar],
  );

  const marcarLida = useCallback(
    (tarefa: Task, lida: boolean) =>
      patch(
        tarefa,
        { acao: lida ? 'marcar-lida' : 'marcar-nao-lida' },
        t('actionFailed'),
      ),
    [patch, t],
  );

  const concluir = useCallback(
    (tarefa: Task, concluida: boolean) =>
      patch(
        tarefa,
        { acao: concluida ? 'concluir' : 'reabrir' },
        t('actionFailed'),
      ),
    [patch, t],
  );

  const marcarImportante = useCallback(
    (tarefa: Task, importante: boolean) =>
      patch(tarefa, { acao: 'importante', valor: importante }, t('actionFailed')),
    [patch, t],
  );

  const editar = useCallback(
    (tarefa: Task, campos: EdicaoDeTarefa) =>
      patch(tarefa, { acao: 'editar', ...campos }, t('actionFailed')),
    [patch, t],
  );

  const apagar = useCallback(
    async (tarefa: Task) => {
      // ⚠️ Mesma convenção do cancelar da agendada (`use-acoes-da-agendada`):
      // apagar é irreversível e mora num menu onde o item vizinho é inofensivo
      // — sem a pergunta, um clique 20px abaixo do pretendido some com a
      // tarefa de outra pessoa sem deixar rastro na tela.
      if (!window.confirm(t('deleteConfirm', { titulo: tarefa.titulo }))) return;
      setOcupada(tarefa.id);
      try {
        const res = await fetch(`/api/cb/tasks/${tarefa.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(json.error ?? t('deleteFailed'));
        }
      } catch {
        toast.error(t('deleteFailed'));
      } finally {
        setOcupada(null);
        aoMudar();
      }
    },
    [t, aoMudar],
  );

  return {
    ocupada,
    criando,
    criar,
    marcarLida,
    concluir,
    marcarImportante,
    editar,
    apagar,
  };
}

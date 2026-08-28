'use client';

// ============================================================
// As tarefas de um cliente, dentro da ficha dele e da conversa (944).
//
// ⚠️ UM COMPONENTE PARA OS DOIS LUGARES. A aba da ficha e a seção da barra
// lateral do inbox mostram a mesma coisa e oferecem as mesmas ações; a única
// diferença real é o espaço disponível, e isso é `compacto`. Em dois
// componentes, uma ação nova entraria num e não no outro — que é exatamente
// como o inbox acabou com dois visualizadores de mídia.
//
// ⚠️ É AQUI QUE A TAREFA NASCE, e não na tela `/tarefas`: toda tarefa é sobre
// um cliente, e este é o único lugar onde o cliente já está decidido. Por isso
// o botão "Nova tarefa" mora neste componente e não naquela tela.
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ListTodo, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TaskForm } from '@/components/tasks/task-form';
import {
  TaskGroupHeading,
  TaskRow,
  type TarefaDaLinha,
} from '@/components/tasks/task-row';
import { useAcoesDaTarefa } from '@/hooks/use-acoes-da-tarefa';
import { useAuth } from '@/hooks/use-auth';
import { useTarefasDoContato } from '@/hooks/use-tarefas-do-contato';
import { agruparPorPrazo } from '@/lib/tasks/prazo';

export interface ContactTasksProps {
  contactId: string;
  /**
   * Versão estreita, para a barra lateral do inbox: esconde as concluídas
   * atrás de um botão e encolhe os espaçamentos. A ficha tem largura para
   * mostrar tudo de uma vez.
   */
  compacto?: boolean;
  /**
   * Some com o título "Tarefas" do cabeçalho.
   *
   * ⚠️ Para a ABA da ficha, onde ele seria eco da aba que a pessoa acabou de
   * clicar — e, pior, ficava na mesma altura da barra de abas, parecendo mais
   * uma delas. Na conversa o título fica: lá a seção divide a barra lateral
   * com outras e precisa se identificar.
   */
  semTitulo?: boolean;
}

export function ContactTasks({
  contactId,
  compacto = false,
  semTitulo = false,
}: ContactTasksProps) {
  const t = useTranslations('Tasks');
  const { user, accountRole } = useAuth();
  const dados = useTarefasDoContato(contactId);
  const acoes = useAcoesDaTarefa(dados.recarregar);

  const [form, setForm] = useState<
    | { modo: 'nova' }
    | { modo: 'editar'; tarefa: TarefaDaLinha }
    | { modo: 'derivar'; pai: TarefaDaLinha; tipo: 'tarefa' | 'resposta' }
    | null
  >(null);
  const [verConcluidas, setVerConcluidas] = useState(!compacto);

  const aoEditar = useCallback((tarefa: TarefaDaLinha) => {
    setForm({ modo: 'editar', tarefa });
  }, []);

  const aoDerivar = useCallback(
    (pai: TarefaDaLinha, tipo: 'tarefa' | 'resposta') => {
      setForm({ modo: 'derivar', pai, tipo });
    },
    [],
  );

  // `new Date()` a cada render é de propósito — ver a nota na página `/tarefas`.
  const grupos = useMemo(
    () => agruparPorPrazo(dados.tarefas, new Date()),
    [dados.tarefas],
  );

  const ator = user && accountRole ? { userId: user.id, papel: accountRole } : null;
  const vazio = !dados.carregando && !dados.falhou && dados.tarefas.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        {semTitulo ? (
          // Mantém o contador visível mesmo sem o título: é ele que responde
          // "tem coisa aberta aqui?" antes de a lista ser lida.
          <span className="text-xs text-muted-foreground">
            {dados.abertas > 0 ? t('openCount', { count: dados.abertas }) : null}
          </span>
        ) : (
          <h3 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ListTodo className="size-4 text-primary" />
            {t('title')}
            {dados.abertas > 0 ? (
              <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {dados.abertas}
              </span>
            ) : null}
          </h3>
        )}
        <Button size="sm" variant="ghost" onClick={() => setForm({ modo: 'nova' })}>
          <Plus className="size-4" />
          {t('newTask')}
        </Button>
      </div>

      {/* A falha tem aviso próprio: cair no vazio afirmaria "não há tarefa"
          logo depois de não ter conseguido descobrir isso. */}
      {dados.falhou ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {t('loadFailed')}
        </div>
      ) : null}

      {dados.carregando ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('loading')}
        </div>
      ) : null}

      {vazio ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          {t('emptyForContact')}
        </p>
      ) : null}

      {ator ? (
        <div className="space-y-4">
          {(
            [
              ['vencidas', 'groupOverdue', true],
              ['hoje', 'groupToday', false],
              ['a_vencer', 'groupUpcoming', false],
            ] as const
          ).map(([chave, rotulo, alerta]) =>
            grupos[chave].length > 0 ? (
              <section key={chave} className="space-y-2">
                <TaskGroupHeading
                  rotulo={t(rotulo)}
                  quantidade={grupos[chave].length}
                  alerta={alerta}
                />
                <ul className="space-y-2">
                  {grupos[chave].map((tarefa) => (
                    <TaskRow
                      key={tarefa.id}
                      tarefa={tarefa}
                      ator={ator}
                      acoes={acoes}
                      aoEditar={aoEditar}
                      aoDerivar={aoDerivar}
                      // Quem está aqui já sabe de quem é o cliente.
                      ocultarCliente
                    />
                  ))}
                </ul>
              </section>
            ) : null,
          )}

          {grupos.concluidas.length > 0 ? (
            <section className="space-y-2">
              {compacto && !verConcluidas ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => setVerConcluidas(true)}
                >
                  {t('showDone', { count: grupos.concluidas.length })}
                </Button>
              ) : (
                <>
                  <TaskGroupHeading
                    rotulo={t('groupDone')}
                    quantidade={grupos.concluidas.length}
                  />
                  <ul className="space-y-2 opacity-75">
                    {grupos.concluidas.map((tarefa) => (
                      <TaskRow
                        key={tarefa.id}
                        tarefa={tarefa}
                        ator={ator}
                        acoes={acoes}
                        aoEditar={aoEditar}
                        aoDerivar={aoDerivar}
                        ocultarCliente
                      />
                    ))}
                  </ul>
                </>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      <TaskForm
        open={!!form}
        onOpenChange={(v) => {
          if (!v) setForm(null);
        }}
        contactId={contactId}
        tarefa={form?.modo === 'editar' ? form.tarefa : null}
        tarefaPai={form?.modo === 'derivar' ? form.pai : null}
        tipo={form?.modo === 'derivar' ? form.tipo : 'tarefa'}
        criar={acoes.criar}
        editar={acoes.editar}
        salvando={acoes.criando || !!acoes.ocupada}
      />
    </div>
  );
}

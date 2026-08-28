'use client';

// ============================================================
// A tela de Tarefas (944) — o lugar onde o colaborador vê o que é dele.
//
// ⚠️ NÃO TEM "NOVA TAREFA", e é de propósito: toda tarefa é SOBRE um cliente
// (`contact_id` é NOT NULL), então ela nasce na ficha dele ou na conversa. Um
// botão aqui teria de começar perguntando "qual cliente?", que é um seletor a
// mais para responder a pergunta que a tela de onde a pessoa veio já respondia.
// O que nasce aqui são as tarefas DERIVADAS — responder e desdobrar —, que já
// herdam o cliente da tarefa de origem.
//
// ⚠️ AS TRÊS VISÕES SÃO DE TODO MUNDO. "Todas" não é painel de admin: a policy
// não recorta por papel e a decisão do operador é que a equipe inteira enxergue
// a fila inteira — tarefa escondida é tarefa que ninguém cobre quando o
// responsável falta.
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, ListTodo, Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { TaskForm } from '@/components/tasks/task-form';
import { TaskGroupHeading, TaskRow } from '@/components/tasks/task-row';
import { useAcoesDaTarefa } from '@/hooks/use-acoes-da-tarefa';
import { useAuth } from '@/hooks/use-auth';
import {
  useTarefas,
  VISOES,
  type TarefaNaTela,
  type VisaoDeTarefas,
} from '@/hooks/use-tarefas';
import { agruparPorPrazo } from '@/lib/tasks/prazo';
import { cn } from '@/lib/utils';

/** Rótulo de cada visão, no dicionário. */
const CHAVE_DA_VISAO: Record<VisaoDeTarefas, string> = {
  'para-mim': 'viewForMe',
  'criadas-por-mim': 'viewCreatedByMe',
  todas: 'viewAll',
};

export default function TarefasPage() {
  const t = useTranslations('Tasks');
  const { user, accountRole } = useAuth();
  const [visao, setVisao] = useState<VisaoDeTarefas>('para-mim');

  const dados = useTarefas(visao);
  const acoes = useAcoesDaTarefa(dados.recarregar);

  // O formulário serve a três intenções: editar, responder e desdobrar. Guardar
  // as três num estado só evita três `useState` que podem estar abertos ao
  // mesmo tempo — e duas caixas abertas sobre a mesma tarefa é estado sem
  // significado.
  const [form, setForm] = useState<
    | { modo: 'editar'; tarefa: TarefaNaTela }
    | { modo: 'derivar'; pai: TarefaNaTela; tipo: 'tarefa' | 'resposta' }
    | null
  >(null);

  const aoEditar = useCallback((tarefa: TarefaNaTela) => {
    setForm({ modo: 'editar', tarefa });
  }, []);

  const aoDerivar = useCallback(
    (pai: TarefaNaTela, tipo: 'tarefa' | 'resposta') => {
      setForm({ modo: 'derivar', pai, tipo });
    },
    [],
  );

  const grupos = useMemo(
    // `new Date()` na render é de propósito: a régua é o relógio de quem lê, e
    // a tela recarrega a cada ação. Memoizar a data faria uma aba aberta desde
    // ontem continuar chamando de "hoje" o dia anterior.
    () => agruparPorPrazo(dados.pendentes, new Date()),
    [dados.pendentes],
  );

  const ator = user && accountRole ? { userId: user.id, papel: accountRole } : null;

  const nadaPendente =
    !dados.carregando &&
    !dados.falhou &&
    dados.pendentes.length === 0 &&
    dados.concluidas.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListTodo className="size-5 text-primary" />
          <h1 className="text-lg font-semibold text-foreground">{t('title')}</h1>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={dados.recarregar}
          disabled={dados.carregando}
        >
          <RefreshCw className={cn('size-4', dados.carregando && 'animate-spin')} />
          {t('refresh')}
        </Button>
      </header>

      {/* Abas de visão */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {VISOES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVisao(v)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              v === visao
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(CHAVE_DA_VISAO[v])}
          </button>
        ))}
      </div>

      {/* ⚠️ A falha tem tela PRÓPRIA. Cair no estado vazio aqui afirmaria "não
          há tarefa nenhuma" logo depois de não ter conseguido descobrir isso —
          e alguém iria embora achando que não tem nada para fazer. */}
      {dados.falhou ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />
          {t('loadFailed')}
        </div>
      ) : null}

      {dados.carregando ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {t('loading')}
        </div>
      ) : null}

      {dados.pendentesTruncadas ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {t('truncated')}
        </div>
      ) : null}

      {nadaPendente ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {visao === 'para-mim' ? t('emptyForMe') : t('empty')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground/80">{t('emptyHint')}</p>
        </div>
      ) : null}

      {ator ? (
        <div className="space-y-5">
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
                    />
                  ))}
                </ul>
              </section>
            ) : null,
          )}

          {dados.concluidas.length > 0 ? (
            <section className="space-y-2">
              <TaskGroupHeading
                rotulo={t('groupDone')}
                // ⚠️ O total da CONTA, não o que está carregado: o acervo
                // pagina, e "50" numa conta com 300 seria informação errada.
                quantidade={dados.totalConcluidas}
              />
              <ul className="space-y-2 opacity-75">
                {dados.concluidas.map((tarefa) => (
                  <TaskRow
                    key={tarefa.id}
                    tarefa={tarefa}
                    ator={ator}
                    acoes={acoes}
                    aoEditar={aoEditar}
                    aoDerivar={aoDerivar}
                  />
                ))}
              </ul>
              {dados.temMaisConcluidas ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={dados.carregarMaisConcluidas}
                >
                  {t('loadMore')}
                </Button>
              ) : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <TaskForm
        open={!!form}
        onOpenChange={(v) => {
          if (!v) setForm(null);
        }}
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

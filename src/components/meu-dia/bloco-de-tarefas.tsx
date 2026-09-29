'use client';

// ============================================================
// As tarefas DA PESSOA (v2, pedido do operador em 29/09/2026: "dar ênfase
// nas tarefas que foram recebidas"): vencidas, de hoje e as NOVAS — recebidas
// e ainda não vistas, de prazo futuro. Cada grupo com o número do banco
// (`count: 'exact'`) e o começo da lista.
//
// ⚠️ Aparecer aqui CONTA como vista (1068): a linha usa o mesmo
// `useVistaDaTarefa` da tela de Tarefas. A marca "Nova" é a da CARGA — fica
// até a próxima, e é o certo: a pessoa acabou de chegar e vê o que era novo.
//
// ⚠️ O item leva à CONVERSA do cliente, senão à ficha (cliente cadastrado à
// mão, sem conversa) — gateado pela tela para onde ELE leva.
// ============================================================

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ListTodo } from 'lucide-react';

import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type { TarefaDoDia, TarefasDoDia } from '@/hooks/use-area-de-trabalho';
import { useVistaDaTarefa } from '@/hooks/use-vista-da-tarefa';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { urlDoInbox } from '@/lib/inbox/url';
import { dataParaExibir, horaParaExibir } from '@/lib/tasks/prazo';
import { cn } from '@/lib/utils';

import { EstadoDoBlocoDaAba } from './blocos-de-operacao';
import { Cabecalho, ForaDoPerfil, LinkDoBloco } from './blocos-pessoais';

/** Quantas tarefas cada grupo lista antes do "e mais N". */
const TAREFAS_POR_GRUPO = 6;

export function BlocoDeTarefas({
  bloco,
  hoje,
  userId,
  veTarefas,
  veInbox,
  veContatos,
}: {
  bloco: Bloco<TarefasDoDia>;
  /** `YYYY-MM-DD` de hoje no dia de quem lê. */
  hoje: string;
  userId: string;
  veTarefas: boolean;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');
  const pronto = bloco.status === 'pronto' ? bloco.dados : null;

  const grupos = pronto
    ? ([
        ['vencidas', t('tasksGroupOverdue'), pronto.vencidas, pronto.totais.vencidas],
        ['hoje', t('tasksGroupToday'), pronto.hoje, pronto.totais.hoje],
        ['novas', t('tasksGroupNew'), pronto.novas, pronto.totais.novas],
      ] as const)
    : [];
  const nada =
    !!pronto &&
    pronto.totais.vencidas + pronto.totais.hoje + pronto.totais.novas === 0;

  return (
    <section className="border-border bg-card flex h-full flex-col rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<ListTodo className="size-4" aria-hidden />}
        titulo={t('tasksTitle')}
        direita={
          pronto ? (
            <span className="text-sm">
              <span
                className={cn(
                  pronto.totais.vencidas > 0 && 'text-destructive font-medium'
                )}
              >
                {tResumo('tasksOverdue', { count: pronto.totais.vencidas })}
              </span>
              {' · '}
              {tResumo('tasksToday', { count: pronto.totais.hoje })}
            </span>
          ) : null
        }
      />
      {!pronto ? (
        <EstadoDoBlocoDaAba bloco={bloco} />
      ) : (
        <div className="mt-2 flex flex-1 flex-col">
          {nada ? (
            <p className="text-muted-foreground text-sm">{t('tasksNoneAll')}</p>
          ) : (
            <div className="space-y-3">
              {grupos.map(([chave, rotulo, itens, total]) =>
                total === 0 ? null : (
                  <div key={chave}>
                    <p
                      className={cn(
                        'text-xs font-medium',
                        chave === 'vencidas'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                      )}
                    >
                      {rotulo} · {total}
                    </p>
                    <ul className="mt-1 space-y-1">
                      {itens.slice(0, TAREFAS_POR_GRUPO).map((tarefa) => (
                        <ItemDeTarefa
                          key={tarefa.id}
                          tarefa={tarefa}
                          hoje={hoje}
                          userId={userId}
                          veInbox={veInbox}
                          veContatos={veContatos}
                        />
                      ))}
                    </ul>
                    {total > Math.min(itens.length, TAREFAS_POR_GRUPO) && (
                      <p className="text-muted-foreground mt-0.5 text-xs">
                        {tResumo('andMore', {
                          count: total - Math.min(itens.length, TAREFAS_POR_GRUPO),
                        })}
                      </p>
                    )}
                  </div>
                )
              )}
            </div>
          )}
          <div className="mt-auto">
            {veTarefas ? (
              <LinkDoBloco
                href="/tarefas"
                texto={tResumo('openTasks')}
                onContinuar={NADA}
              />
            ) : (
              <ForaDoPerfil />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ItemDeTarefa({
  tarefa,
  hoje,
  userId,
  veInbox,
  veContatos,
}: {
  tarefa: TarefaDoDia;
  hoje: string;
  userId: string;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');
  const tTarefas = useTranslations('Tasks');
  // Na tela do responsável por um instante = vista (1068).
  const refDaVista = useVistaDaTarefa(tarefa, userId);

  const nova = !tarefa.vista_em;
  const recebida =
    !!tarefa.criador_user_id && tarefa.criador_user_id !== userId;
  const nome = nomeDoContato(tarefa.contact, tResumo('unknownContact'));
  const hora = horaParaExibir(tarefa.vence_as);

  let prazo: string;
  let vencida = false;
  if (tarefa.vence_em < hoje) {
    const dias = Math.round(
      (dataParaExibir(hoje).getTime() -
        dataParaExibir(tarefa.vence_em).getTime()) /
        86_400_000
    );
    prazo = tResumo('overdueDays', { days: dias });
    vencida = true;
  } else if (tarefa.vence_em === hoje) {
    prazo = hora ? tResumo('dueTodayAt', { hora }) : tResumo('dueToday');
  } else {
    const data = dataParaExibir(tarefa.vence_em).toLocaleDateString(undefined, {
      day: '2-digit',
      month: '2-digit',
    });
    prazo = t('dueOn', { data: hora ? `${data} ${hora}` : data });
  }

  const href = tarefa.conversation_id
    ? veInbox
      ? urlDoInbox({ c: tarefa.conversation_id })
      : null
    : veContatos
      ? `/contacts?contact=${encodeURIComponent(tarefa.contact_id)}`
      : null;

  const conteudo = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          {nova && (
            <span className="border-primary/40 bg-primary/10 text-primary shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium tracking-wider uppercase">
              {t('chipNew')}
            </span>
          )}
          <span className={cn('truncate', nova && 'font-semibold')}>
            {tarefa.titulo}
          </span>
        </span>
        <span className="text-muted-foreground block truncate text-xs">
          {nome}
          {nova && recebida && tarefa.criador_nome
            ? ` · ${tTarefas('fromWho', { nome: tarefa.criador_nome })}`
            : ''}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-xs',
          vencida ? 'text-destructive' : 'text-muted-foreground'
        )}
      >
        {prazo}
      </span>
    </>
  );
  const classes = 'flex items-start justify-between gap-3 rounded-md p-1 text-sm';
  return (
    <li ref={refDaVista}>
      {href ? (
        <Link href={href} className={cn(classes, 'hover:bg-muted/60')}>
          {conteudo}
        </Link>
      ) : (
        <div className={classes}>{conteudo}</div>
      )}
    </li>
  );
}

/** A aba não tem porta acima dela: navegar daqui não confirma nada. */
const NADA = () => {};

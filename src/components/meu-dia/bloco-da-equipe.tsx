'use client';

// ============================================================
// O card "Equipe" do Meu dia (v2, pedido do operador em 29/09/2026): para o
// administrador e para quem vê o Painel (D1 de `docs/PLANO-meu-dia-v2.md`),
// as tarefas VENCIDAS e as de HOJE de cada membro, com quantas o responsável
// ainda NÃO VIU (1068) — "não vista e não cumprida" pede cobrança diferente
// de "vista e não cumprida". Quem não deve nada aparece numa linha "em dia".
//
// A régua (agrupar, ordenar, quem está em dia) é `resumirEquipe`, pura. Aqui
// só a apresentação e o abre-e-fecha de cada pessoa.
//
// ⚠️ Olhar a tarefa de OUTRA pessoa aqui não a marca como vista: a régua de
// `contaComoVista` exige o responsável. É o que o card existe para medir.
// ============================================================

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Users,
} from 'lucide-react';

import type { Bloco } from '@/hooks/use-resumo-do-dia';
import type { Equipe } from '@/hooks/use-area-de-trabalho';
import type { UseMembrosResult } from '@/hooks/use-membros';
import { nomeDoContato } from '@/lib/contacts/identidade';
import { urlDoInbox } from '@/lib/inbox/url';
import {
  resumirEquipe,
  type LinhaDaEquipe,
  type TarefaDaEquipe,
} from '@/lib/meu-dia/equipe';
import { dataParaExibir, horaParaExibir } from '@/lib/tasks/prazo';
import { cn } from '@/lib/utils';

import { De, EstadoDoBlocoDaAba } from './blocos-de-operacao';
import { Cabecalho, LinkDoBloco } from './blocos-pessoais';

type TarefaComConversa = TarefaDaEquipe & { conversation_id: string | null };

export function BlocoDaEquipe({
  bloco,
  membros: lista,
  userId,
  hoje,
  veTarefas,
  veInbox,
  veContatos,
}: {
  bloco: Bloco<Equipe>;
  /** A lista da página — nomes, suspensos e quem está em dia. */
  membros: UseMembrosResult;
  userId: string;
  /** `YYYY-MM-DD` de hoje no dia de quem lê — a régua da tela de Tarefas. */
  hoje: string;
  veTarefas: boolean;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');
  const { membros, carregando: membrosCarregando, falhou: membrosFalharam } =
    lista;
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());

  const resumo = useMemo(
    () =>
      bloco.status === 'pronto' && !membrosCarregando
        ? resumirEquipe(
            bloco.dados.tarefas,
            // Lista que falhou é "não sei quem está na equipe": as tarefas
            // aparecem com o nome congelado, e o "em dia" não é afirmado.
            membrosFalharam ? null : membros,
            userId,
            hoje
          )
        : null,
    [bloco, membros, membrosCarregando, membrosFalharam, userId, hoje]
  );

  const alternar = (chave: string) =>
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });

  const comVencidas =
    resumo?.comTarefas.filter((l) => l.vencidas.length > 0).length ?? 0;

  return (
    <section className="border-primary/30 bg-card rounded-xl border p-4 shadow-sm">
      <Cabecalho
        icone={<Users className="text-primary size-4" aria-hidden />}
        titulo={t('teamTitle')}
        direita={
          resumo ? (
            <span className="flex items-center gap-2 text-sm">
              {comVencidas > 0 ? (
                <span className="text-destructive font-medium">
                  {t('teamSummaryLate', { count: comVencidas })}
                </span>
              ) : (
                <span className="text-emerald-700 dark:text-emerald-300">
                  {t('teamAllClear')}
                </span>
              )}
              <De escopo="escritorio" />
            </span>
          ) : null
        }
      />
      {!resumo ? (
        <EstadoDoBlocoDaAba
          bloco={bloco.status === 'pronto' ? { status: 'carregando' } : bloco}
        />
      ) : (
        <div className="mt-3">
          {resumo.comTarefas.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('teamNone')}</p>
          ) : (
            <ul className="divide-border divide-y">
              {resumo.comTarefas.map((linha) => {
                const chave = linha.userId ?? 'sem-responsavel';
                return (
                  <LinhaDaPessoa
                    key={chave}
                    linha={linha}
                    aberta={abertos.has(chave)}
                    onAlternar={() => alternar(chave)}
                    hoje={hoje}
                    veInbox={veInbox}
                    veContatos={veContatos}
                  />
                );
              })}
            </ul>
          )}

          {resumo.emDia === null ? (
            <p className="text-muted-foreground mt-3 text-xs">
              {t('teamMembersFailed')}
            </p>
          ) : resumo.emDia.length > 0 ? (
            <p className="text-muted-foreground mt-3 flex items-start gap-1.5 text-xs">
              <CheckCircle2
                className="mt-px size-3.5 shrink-0 text-emerald-700 dark:text-emerald-300"
                aria-hidden
              />
              <span>
                {t('teamUpToDate', {
                  nomes: resumo.emDia.map((m) => m.nome).join(', '),
                })}
              </span>
            </p>
          ) : null}

          {veTarefas && (
            <LinkDoBloco
              href="/tarefas"
              texto={tResumo('openTasks')}
              onContinuar={NADA}
            />
          )}
        </div>
      )}
    </section>
  );
}

function LinhaDaPessoa({
  linha,
  aberta,
  onAlternar,
  hoje,
  veInbox,
  veContatos,
}: {
  linha: LinhaDaEquipe<TarefaComConversa>;
  aberta: boolean;
  onAlternar: () => void;
  hoje: string;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  const nome = linha.nome ?? t('teamNoOwner');
  const Seta = aberta ? ChevronDown : ChevronRight;
  return (
    <li className="py-2">
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberta}
        className="hover:bg-muted/60 flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-md px-1 py-1 text-left text-sm"
      >
        <span className="flex min-w-0 flex-1 basis-48 items-center gap-1.5">
          <Seta className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <span className="text-foreground truncate font-medium">{nome}</span>
          {linha.suspenso && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[11px]">
              {t('teamSuspended')}
            </span>
          )}
          {linha.foraDaEquipe && (
            <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[11px]">
              {t('teamLeft')}
            </span>
          )}
        </span>
        <Contagem
          rotulo={t('teamOverdue', { count: linha.vencidas.length })}
          naoVistas={linha.vencidasNaoVistas}
          grave={linha.vencidas.length > 0}
        />
        <Contagem
          rotulo={t('teamToday', { count: linha.hoje.length })}
          naoVistas={linha.hojeNaoVistas}
          grave={false}
        />
      </button>
      {aberta && (
        <ul className="mt-1 space-y-1 pl-6">
          {[...linha.vencidas, ...linha.hoje].map((tarefa) => (
            <ItemDaEquipe
              key={tarefa.id}
              tarefa={tarefa}
              hoje={hoje}
              veInbox={veInbox}
              veContatos={veContatos}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function Contagem({
  rotulo,
  naoVistas,
  grave,
}: {
  rotulo: string;
  naoVistas: number;
  grave: boolean;
}) {
  const t = useTranslations('MeuDia');
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-xs">
      <span
        className={cn(
          'tabular-nums',
          grave ? 'text-destructive font-medium' : 'text-muted-foreground'
        )}
      >
        {rotulo}
      </span>
      {naoVistas > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-amber-700 dark:text-amber-300">
          <EyeOff className="size-3" aria-hidden />
          {t('teamNotSeen', { count: naoVistas })}
        </span>
      )}
    </span>
  );
}

function ItemDaEquipe({
  tarefa,
  hoje,
  veInbox,
  veContatos,
}: {
  tarefa: TarefaComConversa;
  hoje: string;
  veInbox: boolean;
  veContatos: boolean;
}) {
  const t = useTranslations('MeuDia');
  const tResumo = useTranslations('ResumoDoDia');
  const nome = nomeDoContato(tarefa.contact, tResumo('unknownContact'));
  const hora = horaParaExibir(tarefa.vence_as);
  const vencida = tarefa.vence_em < hoje;
  const prazo = vencida
    ? tResumo('overdueDays', {
        days: Math.round(
          (dataParaExibir(hoje).getTime() -
            dataParaExibir(tarefa.vence_em).getTime()) /
            86_400_000
        ),
      })
    : hora
      ? tResumo('dueTodayAt', { hora })
      : tResumo('dueToday');

  const href = tarefa.conversation_id
    ? veInbox
      ? urlDoInbox({ c: tarefa.conversation_id })
      : null
    : veContatos
      ? `/contacts?contact=${encodeURIComponent(tarefa.contact_id)}`
      : null;

  const conteudo = (
    <>
      <span className="min-w-0 flex-1 truncate">
        {tarefa.titulo}
        <span className="text-muted-foreground"> · {nome}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs">
        {tarefa.vista_em ? (
          <span className="text-muted-foreground inline-flex items-center gap-1">
            <Eye className="size-3" aria-hidden />
            {t('teamSeenAt', {
              quando: new Date(tarefa.vista_em).toLocaleString(undefined, {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              }),
            })}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
            <EyeOff className="size-3" aria-hidden />
            {t('teamNotSeenYet')}
          </span>
        )}
        <span className={vencida ? 'text-destructive' : 'text-muted-foreground'}>
          {prazo}
        </span>
      </span>
    </>
  );
  const classes = 'flex items-baseline justify-between gap-3 rounded-md px-1 py-0.5 text-sm';
  return (
    <li>
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

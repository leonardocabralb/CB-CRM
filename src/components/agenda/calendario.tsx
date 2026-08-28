'use client';

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import { FUSO_PADRAO } from '@/lib/agenda/fuso';
import {
  diaDaReuniao,
  gradeDaSemana,
  gradeDoMes,
  horaDaReuniao,
  type DiaDaGrade,
  type Visao,
} from '@/lib/agenda/grade';
import type { Meeting } from '@/types';

/**
 * A grade do calendário (migration 945).
 *
 * ⚠️ ARRASTAR MOVE O DIA, NUNCA A HORA. Soltar a reunião das 14h de terça na
 * quinta deixa-a às 14h de quinta. Mover a hora exigiria uma grade com faixas
 * horárias e alvo de soltura por faixa — e a visão de mês, que é a principal,
 * não tem onde desenhar isso. Quem precisa mudar a hora abre a reunião.
 *
 * A distância de ativação de 5px é a mesma do Kanban de funis: sem ela, um
 * clique com o mouse tremendo vira arraste e a reunião muda de dia sozinha.
 */

interface Props {
  visao: Visao;
  referencia: string;
  hoje: string;
  reunioes: Meeting[];
  aoAbrirReuniao: (reuniao: Meeting) => void;
  aoCriarNoDia: (dia: string) => void;
  aoMover: (reuniao: Meeting, novoDia: string) => void;
}

const CORES: Record<string, string> = {
  agendada: 'bg-primary/15 text-primary border-primary/30',
  realizada: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30',
  cancelada: 'bg-muted text-muted-foreground border-border line-through',
  falta: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30',
};

export function Calendario({
  visao,
  referencia,
  hoje,
  reunioes,
  aoAbrirReuniao,
  aoCriarNoDia,
  aoMover,
}: Props) {
  const t = useTranslations('Agenda');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const dias: DiaDaGrade[] =
    visao === 'mes'
      ? gradeDoMes(referencia, hoje)
      : visao === 'semana'
        ? gradeDaSemana(referencia, hoje)
        : [{ dia: referencia, doMesAtual: true, ehHoje: referencia === hoje }];

  // Agrupa uma vez, em vez de filtrar a lista inteira dentro de cada célula —
  // com 42 células isso seria 42 varreduras a cada render.
  const porDia = new Map<string, Meeting[]>();
  for (const r of reunioes) {
    const dia = diaDaReuniao(r.starts_at, FUSO_PADRAO);
    const lista = porDia.get(dia);
    if (lista) lista.push(r);
    else porDia.set(dia, [r]);
  }

  function aoSoltar(evento: DragEndEvent) {
    const destino = evento.over?.id;
    if (typeof destino !== 'string') return;

    const reuniao = reunioes.find((r) => r.id === evento.active.id);
    if (!reuniao) return;

    // Soltar no mesmo dia não é movimento — sem esta guarda, todo clique que
    // passa de 5px dispara um PATCH inútil.
    if (diaDaReuniao(reuniao.starts_at, FUSO_PADRAO) === destino) return;

    aoMover(reuniao, destino);
  }

  const nomesDosDias = [
    t('dom'),
    t('seg'),
    t('ter'),
    t('qua'),
    t('qui'),
    t('sex'),
    t('sab'),
  ];

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={aoSoltar}>
      {visao !== 'dia' && (
        <div className="grid grid-cols-7 gap-px border-b border-border">
          {nomesDosDias.map((nome) => (
            <div
              key={nome}
              className="px-2 py-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {nome}
            </div>
          ))}
        </div>
      )}

      <div
        className={cn(
          'grid gap-px bg-border',
          visao === 'dia' ? 'grid-cols-1' : 'grid-cols-7',
        )}
      >
        {dias.map((d) => (
          <Celula
            key={d.dia}
            dia={d}
            visao={visao}
            reunioes={porDia.get(d.dia) ?? []}
            aoAbrirReuniao={aoAbrirReuniao}
            aoCriarNoDia={aoCriarNoDia}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Celula({
  dia,
  visao,
  reunioes,
  aoAbrirReuniao,
  aoCriarNoDia,
}: {
  dia: DiaDaGrade;
  visao: Visao;
  reunioes: Meeting[];
  aoAbrirReuniao: (r: Meeting) => void;
  aoCriarNoDia: (dia: string) => void;
}) {
  const t = useTranslations('Agenda');
  const { setNodeRef, isOver } = useDroppable({ id: dia.dia });

  const numero = Number(dia.dia.slice(-2));

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group flex flex-col gap-1 bg-background p-1.5',
        visao === 'mes' ? 'min-h-24' : 'min-h-48',
        !dia.doMesAtual && 'bg-muted/40',
        isOver && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums',
            dia.ehHoje && 'bg-primary font-semibold text-primary-foreground',
            !dia.ehHoje && !dia.doMesAtual && 'text-muted-foreground/60',
            !dia.ehHoje && dia.doMesAtual && 'text-foreground',
          )}
        >
          {numero}
        </span>
        <button
          type="button"
          onClick={() => aoCriarNoDia(dia.dia)}
          aria-label={t('novaReuniaoNesteDia')}
          className="rounded px-1 text-sm leading-none text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
        >
          +
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {reunioes.map((r) => (
          <Cartao key={r.id} reuniao={r} aoAbrir={aoAbrirReuniao} />
        ))}
      </div>
    </div>
  );
}

function Cartao({
  reuniao,
  aoAbrir,
}: {
  reuniao: Meeting;
  aoAbrir: (r: Meeting) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reuniao.id,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...listeners}
      {...attributes}
      onClick={() => aoAbrir(reuniao)}
      className={cn(
        'w-full truncate rounded border px-1.5 py-1 text-left text-xs transition-opacity',
        CORES[reuniao.status] ?? CORES.agendada,
        isDragging && 'opacity-40',
      )}
      title={`${horaDaReuniao(reuniao.starts_at, FUSO_PADRAO)} · ${reuniao.titulo}`}
    >
      <span className="font-medium tabular-nums">
        {horaDaReuniao(reuniao.starts_at, FUSO_PADRAO)}
      </span>{' '}
      {reuniao.titulo}
    </button>
  );
}

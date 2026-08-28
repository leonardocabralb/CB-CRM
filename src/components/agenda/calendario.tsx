'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
 *
 * ⚠️ O CARTÃO QUE SEGUE O CURSOR É UM `DragOverlay`, não o cartão original.
 * Sem ele o `useDraggable` só marca o elemento como "sendo arrastado" — nada se
 * move na tela, e o operador solta no lugar certo sem nunca ter visto o que
 * estava carregando. Mesmo desenho do Kanban de funis.
 *
 * ⚠️ O cartão é uma `<div role="button">`, não um `<button>`: o elemento nativo
 * tem arraste próprio no HTML e disputa o gesto com o dnd-kit.
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

  // Qual reunião está na mão, para o overlay saber o que desenhar.
  const [arrastando, setArrastando] = useState<string | null>(null);

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

  function aoPegar(evento: DragStartEvent) {
    setArrastando(String(evento.active.id));
  }

  function aoSoltar(evento: DragEndEvent) {
    setArrastando(null);
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
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={aoPegar}
      onDragEnd={aoSoltar}
      onDragCancel={() => setArrastando(null)}
    >
      {visao !== 'dia' && (
        <div className="grid shrink-0 grid-cols-7 gap-px border-b border-border">
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

      {/* ⚠️ `flex-1` para a grade ocupar o que sobra. Sem isto, semana e dia
          param na altura mínima da célula e deixam um bloco vazio embaixo —
          com as divisórias entre os dias interrompidas no meio da tela. */}
      <div
        className={cn(
          'grid flex-1 gap-px bg-border',
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

      <DragOverlay
        dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}
      >
        {arrastando ? (
          <Cartao
            reuniao={reunioes.find((r) => r.id === arrastando)!}
            aoAbrir={() => {}}
            noOverlay
          />
        ) : null}
      </DragOverlay>
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
        // No mês a altura é fixa e a grade rola (6 semanas não cabem na tela).
        // Na semana e no dia a célula cresce com a grade, que agora estica.
        visao === 'mes' ? 'min-h-24' : 'min-h-48 h-full',
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
  noOverlay = false,
}: {
  reuniao: Meeting;
  aoAbrir: (r: Meeting) => void;
  /** `true` no clone que segue o cursor — ele não escuta nem é arrastável. */
  noOverlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: reuniao.id,
    disabled: noOverlay,
  });

  const conteudo = (
    <>
      <span className="font-medium tabular-nums">
        {horaDaReuniao(reuniao.starts_at, FUSO_PADRAO)}
      </span>{' '}
      {reuniao.titulo}
    </>
  );

  if (noOverlay) {
    return (
      <div
        className={cn(
          'cursor-grabbing truncate rounded border px-1.5 py-1 text-left text-xs shadow-lg',
          CORES[reuniao.status] ?? CORES.agendada,
        )}
      >
        {conteudo}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      // ⚠️ `attributes` já traz `role="button"` e `tabIndex` — declarar os dois
      // aqui em cima faz o spread sobrescrevê-los, e o TS acusa (TS2783).
      {...listeners}
      {...attributes}
      onClick={() => aoAbrir(reuniao)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          aoAbrir(reuniao);
        }
      }}
      // ⚠️ `touchAction: none` é o que faz o arraste funcionar no celular: sem
      // ele o navegador entende o gesto como rolagem e o dnd-kit nunca recebe.
      style={{ touchAction: 'none' }}
      className={cn(
        'w-full cursor-grab truncate rounded border px-1.5 py-1 text-left text-xs',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        CORES[reuniao.status] ?? CORES.agendada,
        // O original some enquanto o clone está na mão — dois cartões iguais na
        // tela fazem parecer que a reunião foi duplicada.
        isDragging && 'opacity-30',
      )}
      title={`${horaDaReuniao(reuniao.starts_at, FUSO_PADRAO)} · ${reuniao.titulo}`}
    >
      {conteudo}
    </div>
  );
}

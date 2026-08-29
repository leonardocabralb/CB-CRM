'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';

import { FUSO_PADRAO } from '@/lib/agenda/fuso';
import {
  ALTURA_DA_HORA,
  ALTURA_TOTAL,
  HORA_INICIAL,
  horasDaRegua,
  minutosDoDeslocamento,
  posicionarNoDia,
  topoDoAgora,
  type ReuniaoPosicionada,
} from '@/lib/agenda/grade-horaria';
import {
  diaDaReuniao,
  gradeDaSemana,
  horaDaReuniao,
  type DiaDaGrade,
  type Visao,
} from '@/lib/agenda/grade';
import { cn } from '@/lib/utils';
import { mostrarResponsavel } from '@/lib/agenda/responsaveis';
import type { Meeting } from '@/types';

/**
 * A grade de horas das visões de semana e dia (migration 945).
 *
 * Colunas de dia × linhas de hora, com cada reunião desenhada onde começa e
 * alta conforme dura — a leitura que a lista simples não dava: "a tarde de
 * quinta está livre" só se enxerga assim.
 *
 * ⚠️ ARRASTAR AQUI MUDA DIA **E** HORA, ao contrário da visão de mês. A coluna
 * de destino dá o dia; o deslocamento vertical, convertido em minutos e
 * arredondado a 15, dá a hora. Sem a hora, arrastar na grade de horas seria
 * um gesto que ignora a dimensão que a própria grade existe para mostrar.
 *
 * ⚠️ `pointerWithin` em vez de `closestCorners`: as colunas são altas e
 * estreitas, e a detecção por proximidade de canto escolhe a coluna vizinha
 * quando se solta perto do rodapé. Aqui o que vale é onde o ponteiro está.
 */

interface Props {
  visao: Extract<Visao, 'semana' | 'dia'>;
  referencia: string;
  hoje: string;
  reunioes: Meeting[];
  aoAbrirReuniao: (reuniao: Meeting) => void;
  aoCriarEm: (dia: string, hora: string) => void;
  aoMover: (reuniao: Meeting, novoDia: string, minutos: number) => void;
}

const CORES: Record<string, string> = {
  agendada: 'bg-primary/20 text-primary border-l-primary',
  realizada:
    'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-l-emerald-500',
  cancelada: 'bg-muted text-muted-foreground border-l-border line-through',
  falta: 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-l-amber-500',
};

export function GradeDeHoras({
  visao,
  referencia,
  hoje,
  reunioes,
  aoAbrirReuniao,
  aoCriarEm,
  aoMover,
}: Props) {
  const t = useTranslations('Agenda');
  const [arrastando, setArrastando] = useState<Meeting | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const dias: DiaDaGrade[] =
    visao === 'semana'
      ? gradeDaSemana(referencia, hoje)
      : [{ dia: referencia, doMesAtual: true, ehHoje: referencia === hoje }];

  // Abre já no começo do expediente em vez de às 6h — a grade tem 18 horas e
  // quase toda reunião cai depois das 8.
  useEffect(() => {
    if (rolagem.current) {
      rolagem.current.scrollTop = (8 - HORA_INICIAL) * ALTURA_DA_HORA;
    }
  }, []);

  const comResponsavel = mostrarResponsavel(reunioes);

  const porDia = new Map<string, Meeting[]>();
  for (const r of reunioes) {
    const dia = diaDaReuniao(r.starts_at, FUSO_PADRAO);
    const lista = porDia.get(dia);
    if (lista) lista.push(r);
    else porDia.set(dia, [r]);
  }

  function aoSoltar(evento: DragEndEvent) {
    setArrastando(null);

    const destino = evento.over?.id;
    if (typeof destino !== 'string') return;

    const reuniao = reunioes.find((r) => r.id === evento.active.id);
    if (!reuniao) return;

    const minutos = minutosDoDeslocamento(evento.delta.y);
    const mesmoDia = diaDaReuniao(reuniao.starts_at, FUSO_PADRAO) === destino;

    // Nem mudou de dia nem de hora: não há o que gravar.
    if (mesmoDia && minutos === 0) return;

    aoMover(reuniao, destino, minutos);
  }

  const agora = topoDoAgora(new Date(), FUSO_PADRAO);
  const nomesCurtos = [t('dom'), t('seg'), t('ter'), t('qua'), t('qui'), t('sex'), t('sab')];

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e: DragStartEvent) =>
        setArrastando(reunioes.find((r) => r.id === e.active.id) ?? null)
      }
      onDragEnd={aoSoltar}
      onDragCancel={() => setArrastando(null)}
    >
      <div ref={rolagem} className="flex-1 overflow-y-auto">
        {/* ⚠️ O cabeçalho fica DENTRO do contêiner que rola, como `sticky`.
            Fora dele, o cabeçalho teria a largura cheia e o corpo teria essa
            largura MENOS a barra de rolagem (15px medidos aqui) — as sete
            colunas saíam desalinhadas do cabeçalho por ~2px cada, e o erro
            crescia para a direita. Dentro, os dois compartilham a mesma
            largura por construção. */}
        <div className="sticky top-0 z-30 flex border-b border-border bg-background">
          <div className="w-14 shrink-0" />
          {dias.map((d) => (
            <div
              key={d.dia}
              className="flex-1 border-l border-border px-2 py-1.5 text-center"
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {nomesCurtos[new Date(`${d.dia}T12:00:00Z`).getUTCDay()]}
              </div>
              <div
                className={cn(
                  'mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm tabular-nums',
                  d.ehHoje
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'text-foreground',
                )}
              >
                {Number(d.dia.slice(-2))}
              </div>
            </div>
          ))}
        </div>

        <div className="relative flex" style={{ height: ALTURA_TOTAL }}>
          {/* A régua de horas. */}
          <div className="w-14 shrink-0">
            {horasDaRegua().map((h) => (
              <div
                key={h}
                className="relative text-right"
                style={{ height: ALTURA_DA_HORA }}
              >
                <span className="absolute -top-2 right-2 text-[11px] tabular-nums text-muted-foreground">
                  {String(h).padStart(2, '0')}:00
                </span>
              </div>
            ))}
          </div>

          {dias.map((d) => (
            <ColunaDoDia
              key={d.dia}
              dia={d}
              reunioes={porDia.get(d.dia) ?? []}
              comResponsavel={comResponsavel}
              ehHoje={d.ehHoje}
              agora={agora}
              aoAbrirReuniao={aoAbrirReuniao}
              aoCriarEm={aoCriarEm}
            />
          ))}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2,0,0,1)' }}>
        {arrastando ? (
          <div
            className={cn(
              'rounded border-l-2 px-1.5 py-1 text-xs shadow-lg',
              CORES[arrastando.status] ?? CORES.agendada,
            )}
          >
            <span className="font-medium tabular-nums">
              {horaDaReuniao(arrastando.starts_at, FUSO_PADRAO)}
            </span>{' '}
            {arrastando.titulo}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function ColunaDoDia({
  dia,
  reunioes,
  comResponsavel,
  ehHoje,
  agora,
  aoAbrirReuniao,
  aoCriarEm,
}: {
  dia: DiaDaGrade;
  reunioes: Meeting[];
  comResponsavel: boolean;
  ehHoje: boolean;
  agora: number | null;
  aoAbrirReuniao: (r: Meeting) => void;
  aoCriarEm: (dia: string, hora: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dia.dia });
  const posicionadas = posicionarNoDia(reunioes, FUSO_PADRAO);

  /**
   * Clicar num espaço vazio abre o formulário já naquele horário.
   *
   * A hora sai da posição do clique dentro da coluna, arredondada para baixo à
   * meia hora — clicar "no meio das 9h" quer dizer 9h, não 9h23.
   */
  function aoClicarNoVazio(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return; // clique num cartão, não no vazio
    const caixa = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - caixa.top;
    const minutos = (y / ALTURA_DA_HORA) * 60 + HORA_INICIAL * 60;
    const arredondado = Math.floor(minutos / 30) * 30;
    const h = Math.floor(arredondado / 60);
    const m = arredondado % 60;
    aoCriarEm(
      dia.dia,
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
    );
  }

  return (
    <div
      ref={setNodeRef}
      onClick={aoClicarNoVazio}
      className={cn(
        'relative flex-1 border-l border-border',
        isOver && 'bg-primary/5',
      )}
    >
      {/* As linhas de hora. `pointer-events-none` para não roubarem o clique
          que abre o formulário. */}
      <div className="pointer-events-none absolute inset-0">
        {horasDaRegua().map((h) => (
          <div
            key={h}
            className="border-t border-border/60"
            style={{ height: ALTURA_DA_HORA }}
          />
        ))}
      </div>

      {ehHoje && agora !== null && (
        <div
          className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
          style={{ top: agora }}
        >
          <span className="absolute -left-1 -top-1 size-2 rounded-full bg-red-500" />
        </div>
      )}

      {posicionadas.map((p) => (
        <CartaoNaGrade
          key={p.reuniao.id}
          pos={p}
          comResponsavel={comResponsavel}
          aoAbrir={aoAbrirReuniao}
        />
      ))}
    </div>
  );
}

function CartaoNaGrade({
  pos,
  comResponsavel,
  aoAbrir,
}: {
  pos: ReuniaoPosicionada;
  comResponsavel: boolean;
  aoAbrir: (r: Meeting) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: pos.reuniao.id,
  });

  const largura = 100 / pos.colunas;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation(); // não deixa o clique virar "criar aqui"
        aoAbrir(pos.reuniao);
      }}
      style={{
        position: 'absolute',
        top: pos.topo,
        height: pos.altura,
        left: `calc(${pos.coluna * largura}% + 2px)`,
        width: `calc(${largura}% - 4px)`,
        touchAction: 'none',
      }}
      className={cn(
        'z-20 cursor-grab overflow-hidden rounded border-l-2 px-1.5 py-0.5 text-left text-[11px] leading-tight',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary',
        CORES[pos.reuniao.status] ?? CORES.agendada,
        isDragging && 'opacity-30',
      )}
      title={`${horaDaReuniao(pos.reuniao.starts_at, FUSO_PADRAO)} · ${pos.reuniao.titulo} · ${pos.reuniao.owner_nome}`}
    >
      <div className="font-medium tabular-nums">
        {horaDaReuniao(pos.reuniao.starts_at, FUSO_PADRAO)}
      </div>
      <div className="truncate">{pos.reuniao.titulo}</div>
      {/* O nome só entra quando a reunião é alta o bastante para ele caber —
          abaixo de ~40px ele empurraria o título para fora. */}
      {comResponsavel && pos.altura >= 40 && (
        <div className="truncate opacity-70">{pos.reuniao.owner_nome}</div>
      )}
    </div>
  );
}

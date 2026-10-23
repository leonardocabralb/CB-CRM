'use client';

// ============================================================
// "Mover para a Lixeira" (1097) — a exclusão de contato da tela de Contatos.
//
// Decisões do operador (22/10/2026, docs/PLANO-lixeira-de-contatos.md): só
// admin; a ficha fica 90 dias na Lixeira e pode ser restaurada (B1); os
// negócios ficam no funil sem contato, com a marca (B4); o toast tem
// "Desfazer" por alguns segundos, só para quem moveu, chamando a MESMA
// restauração pelo lote (B5).
//
// ⚠️ SEM PRÉVIA, SEM BOTÃO. O que a exclusão cancela de COLEGAS (agendada de
// outra pessoa, espera de automação, robô, tarefa aberta, conversa com
// responsável) NÃO volta com a restauração do jeito que estava — a tela diz
// antes, pela prévia do banco. Enquanto ela carrega, o botão espera; se
// falha, o botão não aparece habilitado: vazio por ignorância nunca vira
// "nada a cancelar" (seção 8c).
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  moverParaLixeira,
  restaurar,
  usePreviaDaLixeira,
  type EstadoDaPreviaDaLixeira,
  type ResultadoDoMoverNaTela,
} from '@/hooks/use-lixeira';
import {
  previaTemAviso,
  resolvidosDoMover,
  type MotivoDaLixeira,
  type PreviaDaFicha,
} from '@/lib/contacts/lixeira';
import { dataParaExibir } from '@/lib/tasks/prazo';

import { avisarVolta } from './lixeira/avisar-volta';
import { textoDoMotivo, type TradutorDaLixeira } from './lixeira/textos-da-lixeira';

export interface MoverParaLixeiraDialogProps {
  /** As fichas a mover, capturadas na abertura; NULO = fechado. */
  ids: string[] | null;
  aoFechar: () => void;
  /** Depois de mover: os RESOLVIDOS (movidas e as que já não existiam) —
   *  quem chama poda a seleção por eles e recarrega a lista. */
  aoMover: (resolvidos: string[]) => void;
  /** Depois do "Desfazer": a lista recarrega. Chamado pela versão mais
   *  recente (o toast vive mais que o render que o criou). */
  aoDesfazer: () => void;
}

export function MoverParaLixeiraDialog({
  ids,
  aoFechar,
  aoMover,
  aoDesfazer,
}: MoverParaLixeiraDialogProps) {
  const t = useTranslations('Contacts.lixeira');
  const [movendo, setMovendo] = useState(false);
  // O "Desfazer" é clicado até 10 s depois, talvez noutra página da lista:
  // a recarga tem de ser a da página ATUAL, não a do render que criou o toast.
  const aoDesfazerRef = useRef(aoDesfazer);
  useEffect(() => {
    aoDesfazerRef.current = aoDesfazer;
  });

  const aberto = ids !== null && ids.length > 0;

  async function desfazer(lote: string) {
    avisarVolta(t, await restaurar({ lote }));
    aoDesfazerRef.current();
  }

  function avisarMover(r: ResultadoDoMoverNaTela) {
    const movidas = r.fichas.filter((f) => f.resultado === 'movida').length;
    const sumidas = r.fichas.filter((f) => f.resultado === 'sumiu').length;
    const recusadas = r.fichas.filter((f) => f.resultado === 'recusada');
    // O número é o que SAIU, nunca o que se pediu.
    if (movidas > 0) {
      const lote = r.loteId;
      toast.success(t('mover.toastMovidas', { count: movidas }), {
        description: t('mover.toastMovidasDica'),
        // B5: "alguns segundos" — os 4 s do padrão somem antes de achar o botão.
        duration: 10_000,
        action: lote
          ? { label: t('mover.desfazer'), onClick: () => void desfazer(lote) }
          : undefined,
      });
    }
    if (sumidas > 0) toast.info(t('mover.toastSumidas', { count: sumidas }));
    if (recusadas.length > 0) {
      const motivos = [
        ...new Set(recusadas.map((f) => f.motivo ?? ('falhou' as MotivoDaLixeira))),
      ];
      toast.error(t('mover.toastRecusadas', { count: recusadas.length }), {
        description: motivos.map((m) => textoDoMotivo(t, m)).join(' '),
        duration: 10_000,
      });
    }
  }

  async function confirmar(alvo: string[]) {
    setMovendo(true);
    const r = await moverParaLixeira(alvo);
    setMovendo(false);
    avisarMover(r);
    aoMover(resolvidosDoMover(r.fichas));
    aoFechar();
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(abrir) => {
        if (!abrir && !movendo) aoFechar();
      }}
    >
      <DialogContent className="max-h-[calc(var(--altura-visivel,100dvh)-2rem)] overflow-y-auto bg-popover border-border text-popover-foreground sm:max-w-lg">
        {/* Montado só aberto e por seleção: reabrir com as mesmas fichas
            relê a prévia (a de minutos atrás pode ter mudado). */}
        {ids && ids.length > 0 && (
          <CorpoDoMover
            key={ids.join(',')}
            ids={ids}
            movendo={movendo}
            aoCancelar={aoFechar}
            aoConfirmar={() => void confirmar(ids)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CorpoDoMover({
  ids,
  movendo,
  aoCancelar,
  aoConfirmar,
}: {
  ids: string[];
  movendo: boolean;
  aoCancelar: () => void;
  aoConfirmar: () => void;
}) {
  const t = useTranslations('Contacts.lixeira');
  const estado = usePreviaDaLixeira(ids);
  const pronta = estado.previa !== null;

  return (
    <>
      <DialogHeader className="min-w-0">
        <DialogTitle className="text-popover-foreground">{t('mover.titulo')}</DialogTitle>
        <DialogDescription className="text-muted-foreground">
          {t('mover.descricao', { count: ids.length })}
        </DialogDescription>
      </DialogHeader>

      <PreviaDoMover estado={estado} pedidos={ids.length} />

      <DialogFooter className="bg-popover border-border">
        <Button
          variant="outline"
          onClick={aoCancelar}
          disabled={movendo}
          className="border-border text-muted-foreground hover:bg-muted"
        >
          {t('cancelar')}
        </Button>
        <Button variant="destructive" onClick={aoConfirmar} disabled={!pronta || movendo}>
          {movendo || estado.carregando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          {t('mover.confirmar')}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * O que a exclusão cancela, ficha a ficha. Exportado para o teste: carregando
 * e falha NUNCA desenham "nada em andamento".
 */
export function PreviaDoMover({
  estado,
  pedidos,
}: {
  estado: Pick<EstadoDaPreviaDaLixeira, 'previa' | 'carregando' | 'falha' | 'tentarDeNovo'>;
  pedidos: number;
}) {
  const t = useTranslations('Contacts.lixeira');

  if (estado.carregando || (estado.previa === null && estado.falha === null)) {
    return (
      <p className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 shrink-0 animate-spin" />
        {t('mover.conferindo')}
      </p>
    );
  }

  if (estado.previa === null) {
    return (
      <div className="min-w-0 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
        <p className="text-destructive">{t('mover.previaFalhou')}</p>
        <p className="text-muted-foreground">{textoDoMotivo(t, estado.falha ?? 'falhou')}</p>
        <Button variant="outline" size="sm" onClick={estado.tentarDeNovo}>
          {t('mover.tentarDeNovo')}
        </Button>
      </div>
    );
  }

  const previa = estado.previa;
  const comAviso = previa.filter(previaTemAviso);
  const semAviso = previa.length - comAviso.length;
  const naoExistem = Math.max(0, pedidos - previa.length);
  const mensagens = previa.reduce((soma, p) => soma + p.mensagens, 0);

  return (
    <div className="min-w-0 space-y-3 text-sm">
      {mensagens > 0 && (
        <p className="text-muted-foreground">{t('mover.mensagens', { count: mensagens })}</p>
      )}
      {comAviso.length > 0 && (
        <p className="font-medium text-foreground">{t('mover.cancelaTitulo')}</p>
      )}
      {comAviso.map((p) => (
        <BlocoDaFicha key={p.id} t={t} p={p} />
      ))}
      {semAviso > 0 && (
        <p className="text-muted-foreground">
          {comAviso.length === 0
            ? t('mover.nadaEmAndamento', { count: semAviso })
            : t('mover.outrasSemNada', { count: semAviso })}
        </p>
      )}
      {naoExistem > 0 && (
        <p className="text-muted-foreground">{t('mover.naoExistem', { count: naoExistem })}</p>
      )}
    </div>
  );
}

function quandoLegivel(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
}

/** `vence_em` é DATE: nunca `new Date()` direto (volta um dia no Brasil). */
function diaLegivel(dia: string | null): string {
  if (!dia) return '—';
  const d = dataParaExibir(dia);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function BlocoDaFicha({ t, p }: { t: TradutorDaLixeira; p: PreviaDaFicha }) {
  const conversaComGente =
    p.conversa !== null && p.conversa.status !== 'closed' && p.conversa.responsavel !== null;
  return (
    <section className="min-w-0 space-y-2 rounded-md border border-border p-3">
      <p className="font-medium break-words text-foreground">{p.nome ?? t('semNome')}</p>
      <ul className="space-y-2 text-muted-foreground">
        {conversaComGente && (
          <li>{t('mover.conversa', { responsavel: p.conversa?.responsavel ?? '' })}</li>
        )}
        {p.agendadas.length > 0 && (
          <li>
            {t('mover.agendadas', { count: p.agendadas.length })}
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {p.agendadas.map((a, i) => (
                <li key={i} className="break-words">
                  {t('mover.agendadaDe', {
                    autor: a.autor ?? t('mover.autorDesconhecido'),
                    quando: quandoLegivel(a.quando),
                  })}
                </li>
              ))}
            </ul>
          </li>
        )}
        {p.esperas > 0 && <li>{t('mover.esperas', { count: p.esperas })}</li>}
        {p.robos > 0 && <li>{t('mover.robos', { count: p.robos })}</li>}
        {p.tarefas.length > 0 && (
          <li>
            {t('mover.tarefas', { count: p.tarefas.length })}
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {p.tarefas.map((tarefa, i) => (
                <li key={i} className="break-words">
                  {t('mover.tarefaDe', {
                    titulo: tarefa.titulo ?? t('mover.semTitulo'),
                    responsavel: tarefa.responsavel ?? t('mover.semResponsavel'),
                    quando: diaLegivel(tarefa.venceEm),
                  })}
                </li>
              ))}
            </ul>
          </li>
        )}
        {p.negocios.length > 0 && (
          <li>
            {t('mover.negocios', { count: p.negocios.length })}
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {p.negocios.map((n, i) => (
                <li key={i} className="break-words">
                  {t('mover.negocioEm', {
                    titulo: n.titulo ?? t('mover.semTitulo'),
                    funil: n.funil ?? '—',
                    etapa: n.etapa ?? '—',
                  })}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>
    </section>
  );
}

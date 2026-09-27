'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Plus } from 'lucide-react';

import { ReuniaoForm } from '@/components/agenda/reuniao-form';
import { Button } from '@/components/ui/button';
import { useReunioesDoContato, useReunioesExternasDoContato } from '@/hooks/use-reunioes';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso } from '@/lib/agenda/fuso';
import { intercalarHistorico, reuniaoTerminou, type ReuniaoExterna } from '@/lib/agenda/reunioes-externas';
import { cn } from '@/lib/utils';
import type { Meeting } from '@/types';

/**
 * As reuniões de um cliente, na ficha dele e na aba Reuniões do painel da
 * conversa: as da agenda do CRM (945), editáveis, e as que vieram de fora —
 * os agendamentos do Calendly e a última reunião da Kommo —, só leitura.
 *
 * O botão "Nova reunião" continua sendo o caminho "operador marca direto" da
 * Fase 1: sem link, sem convite, já ligada ao cliente.
 */
export function ReunioesDoContato({ contactId }: { contactId: string }) {
  const t = useTranslations('Agenda');
  const agenda = useReunioesDoContato(contactId);
  const externas = useReunioesExternasDoContato(contactId);

  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Meeting | null>(null);

  function abrirNovo() {
    setEmEdicao(null);
    setFormAberto(true);
  }

  const agora = new Date();
  // ⚠️ A lista só aparece com as DUAS fontes respondidas: montar a agenda
  // antes das externas faria a aba afirmar "nenhuma reunião" (ou mostrar a
  // agenda sozinha) por um instante e depois pular.
  const carregando = agenda.carregando || externas.carregando;
  const itens = carregando ? [] : intercalarHistorico(agenda.reunioes, externas.reunioes);

  return (
    <div className="space-y-3">
      {/* ⚠️ Sem título de seção: a aba já se chama "Reuniões", e repetir o
          nome logo abaixo dela confunde — com as 7 abas quebrando em três
          linhas, o título alinhava com a última aba e parecia parte dela. */}
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={abrirNovo}>
          <Plus className="size-3.5" />
          {t('novaReuniao')}
        </Button>
      </div>

      {carregando && (
        <p className="text-xs text-muted-foreground">{t('carregando')}</p>
      )}

      {/* Falha das externas é dita, e sem ela "nenhuma reunião" seria
          mentira: o Calendly pode ter tudo e a leitura só não chegou. */}
      {!carregando && externas.falhou && (
        <p className="text-xs text-muted-foreground">{t('erroExternas')}</p>
      )}

      {!carregando && !externas.falhou && itens.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('semReunioes')}</p>
      )}

      <ul className="space-y-2">
        {itens.map((item) =>
          item.tipo === 'agenda' ? (
            <li key={`agenda:${item.reuniao.id}`}>
              <LinhaDaAgenda
                reuniao={item.reuniao}
                agora={agora}
                aoAbrir={() => {
                  setEmEdicao(item.reuniao);
                  setFormAberto(true);
                }}
              />
            </li>
          ) : (
            <li key={`${item.reuniao.origem}:${item.reuniao.id}`}>
              <LinhaExterna reuniao={item.reuniao} agora={agora} />
            </li>
          ),
        )}
      </ul>

      <ReuniaoForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        reuniao={emEdicao}
        contactId={contactId}
        aoSalvar={agenda.recarregar}
      />
    </div>
  );
}

function LinhaDaAgenda({ reuniao: r, agora, aoAbrir }: { reuniao: Meeting; agora: Date; aoAbrir: () => void }) {
  const t = useTranslations('Agenda');
  const inicio = new Date(r.starts_at);
  const passou = inicio < agora;

  return (
    <button
      type="button"
      onClick={aoAbrir}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border border-border p-2.5 text-left transition-colors hover:bg-muted/60',
        r.status === 'cancelada' && 'opacity-60',
      )}
    >
      <CalendarDays
        className={cn(
          'mt-0.5 size-4 shrink-0',
          passou ? 'text-muted-foreground' : 'text-primary',
        )}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            r.status === 'cancelada' && 'line-through',
          )}
        >
          {r.titulo}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {diaNoFuso(inicio, FUSO_PADRAO)} · {horaNoFuso(inicio, FUSO_PADRAO)}
          {' · '}
          {r.owner_nome}
        </p>
        {r.local && (
          <p className="truncate text-xs text-muted-foreground">{r.local}</p>
        )}
      </div>
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {t(
          `status${r.status.charAt(0).toUpperCase()}${r.status.slice(1)}` as
            | 'statusAgendada'
            | 'statusRealizada'
            | 'statusCancelada'
            | 'statusFalta',
        )}
      </span>
    </button>
  );
}

/**
 * Reunião do Calendly ou da Kommo: só leitura (quem manda nela é o Calendly).
 * Sem situação à direita depois que ela termina: o Calendly não diz se o
 * cliente compareceu, e "Realizada" afirmaria o que ninguém registrou.
 * "Terminou" é pelo FIM: durante a reunião ela segue marcada, com o link.
 */
function LinhaExterna({ reuniao: r, agora }: { reuniao: ReuniaoExterna; agora: Date }) {
  const t = useTranslations('Agenda');
  const inicio = new Date(r.inicio);
  const passou = reuniaoTerminou(r, agora);
  const situacao =
    r.desmarcada === 'reagendada'
      ? t('statusReagendada')
      : r.desmarcada === 'cancelada'
        ? t('statusCancelada')
        : passou
          ? null
          : t('statusAgendada');

  return (
    <div
      className={cn(
        'flex w-full items-start gap-2.5 rounded-md border border-border p-2.5',
        r.desmarcada && 'opacity-60',
      )}
    >
      <CalendarDays
        className={cn(
          'mt-0.5 size-4 shrink-0',
          passou || r.desmarcada ? 'text-muted-foreground' : 'text-primary',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', r.desmarcada && 'line-through')}>
          {r.evento ?? t('reuniaoSemNome')}
        </p>
        <p className="text-xs tabular-nums text-muted-foreground">
          {diaNoFuso(inicio, FUSO_PADRAO)} · {horaNoFuso(inicio, FUSO_PADRAO)}
          {' · '}
          {r.origem === 'calendly' ? t('origemCalendly') : t('origemKommo')}
          {r.reagendamento && ` · ${t('reagendamento')}`}
        </p>
        {r.link && !passou && !r.desmarcada && (
          <a
            href={r.link}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-xs text-primary hover:underline"
          >
            {t('linkDaReuniao')}
          </a>
        )}
      </div>
      {situacao && (
        <span className="shrink-0 text-[11px] text-muted-foreground">{situacao}</span>
      )}
    </div>
  );
}

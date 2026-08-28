'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarDays, Plus } from 'lucide-react';

import { ReuniaoForm } from '@/components/agenda/reuniao-form';
import { Button } from '@/components/ui/button';
import { useReunioesDoContato } from '@/hooks/use-reunioes';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso } from '@/lib/agenda/fuso';
import { cn } from '@/lib/utils';
import type { Meeting } from '@/types';

/**
 * As reuniões de um cliente, na ficha dele (migration 945).
 *
 * É o caminho "operador marca direto" da Fase 1: sem link, sem convite — a
 * pessoa escolhe dia e hora e a reunião nasce marcada, já ligada ao cliente.
 */
export function ReunioesDoContato({ contactId }: { contactId: string }) {
  const t = useTranslations('Agenda');
  const { reunioes, carregando, recarregar } = useReunioesDoContato(contactId);

  const [formAberto, setFormAberto] = useState(false);
  const [emEdicao, setEmEdicao] = useState<Meeting | null>(null);

  function abrirNovo() {
    setEmEdicao(null);
    setFormAberto(true);
  }

  const agora = new Date();

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

      {!carregando && reunioes.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('semReunioes')}</p>
      )}

      <ul className="space-y-2">
        {reunioes.map((r) => {
          const inicio = new Date(r.starts_at);
          const passou = inicio < agora;

          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => {
                  setEmEdicao(r);
                  setFormAberto(true);
                }}
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
            </li>
          );
        })}
      </ul>

      <ReuniaoForm
        aberto={formAberto}
        aoFechar={() => setFormAberto(false)}
        reuniao={emEdicao}
        contactId={contactId}
        aoSalvar={recarregar}
      />
    </div>
  );
}

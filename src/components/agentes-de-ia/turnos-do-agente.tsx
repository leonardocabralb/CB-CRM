'use client';

// ============================================================
// Sub-aba Turnos do agente: os 50 últimos turnos (cada vez que o agente foi
// chamado a responder), com o status, quando, o contato, o erro e o link para
// a conversa. Lê `GET /api/cb/ia/agentes/[id]/turnos` (só admin).
//
// ⚠️ Falha de carga diz que falhou — nunca "nenhum turno". O status é chave
// MONTADA (`rotuloDoStatusDoTurno`), cobrada nos dois dicionários.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { urlDoInbox } from '@/lib/inbox/url';
import { cn } from '@/lib/utils';
import { rotuloDoStatusDoTurno } from './textos';

interface Turno {
  id: string;
  status: string;
  criadoEm: string;
  terminadoEm: string | null;
  erro: string | null;
  conversationId: string;
  contato: string | null;
}

const COR_DO_STATUS: Record<string, string> = {
  respondeu: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  passou: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  transferiu: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  incerto: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  falhou: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

export function TurnosDoAgente({ agenteId }: { agenteId: string }) {
  const t = useTranslations('IaAgentes');
  const [turnos, setTurnos] = useState<Turno[] | null>(null);
  const [falhou, setFalhou] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agenteId}/turnos`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { turnos?: Turno[] };
      setTurnos(corpo.turnos ?? []);
      setFalhou(false);
    } catch {
      setFalhou(true);
    }
  }, [agenteId]);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  if (falhou) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('turnos.falhou')}</p>
        <Button variant="outline" size="sm" onClick={() => void carregar()}>
          <RefreshCw className="size-4" /> {t('tentarDeNovo')}
        </Button>
      </div>
    );
  }
  if (turnos === null) return <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t('turnos.explicacao')}</p>
      {turnos.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('turnos.vazio')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {turnos.map((turno) => (
            <li key={turno.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span
                className={cn(
                  'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
                  COR_DO_STATUS[turno.status] ?? 'bg-muted text-muted-foreground'
                )}
              >
                {rotuloDoStatusDoTurno(t, turno.status)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(turno.criadoEm).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
              </span>
              <Link
                href={urlDoInbox({ c: turno.conversationId })}
                className="min-w-0 flex-1 truncate text-primary underline-offset-2 hover:underline"
              >
                {turno.contato ?? t('turnos.semContato')}
              </Link>
              {turno.erro ? (
                <p className="w-full truncate text-xs text-muted-foreground" title={turno.erro}>
                  {turno.erro}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

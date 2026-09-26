'use client';

// ============================================================
// Sub-aba Turnos do agente: os 50 últimos turnos (cada vez que o agente foi
// chamado a responder), com o status, quando, o contato, o erro e o link para
// a conversa. Lê `GET /api/cb/ia/agentes/[id]/turnos` (só admin).
//
// ⚠️ Falha de carga diz que falhou — nunca "nenhum turno". O status é chave
// MONTADA (`rotuloDoStatusDoTurno`), cobrada nos dois dicionários.
//
// F3: cada turno com RETRATO (`contexto`) ganha "O que o agente viu", uma
// expansão com os blocos como foram ao modelo (em inglês, de propósito: é o
// texto que ele leu) e os documentos da base de onde vieram os trechos. É o
// que explica a resposta depois que a ficha, o card ou o documento mudarem.
// Turno anterior ao retrato (contexto nulo) não ganha a expansão. Os nomes
// dos documentos vêm da base de hoje; a leitura que falha mostra só a conta.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Eye, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { urlDoInbox } from '@/lib/inbox/url';
import { cn } from '@/lib/utils';
import { rotuloDoBloco, rotuloDoStatusDoTurno } from './textos';
import type { ContextoDoTurno } from './tipos';

interface Turno {
  id: string;
  status: string;
  criadoEm: string;
  terminadoEm: string | null;
  erro: string | null;
  conversationId: string;
  contato: string | null;
  /** O retrato do turno (F3); nulo nos turnos antigos. */
  contexto: ContextoDoTurno | null;
}

/** Parse, nunca `as`: o retrato é jsonb; forma estranha = sem expansão (nunca quebra a lista). */
function lerContexto(v: unknown): ContextoDoTurno | null {
  if (!v || typeof v !== 'object') return null;
  const { blocos, documentos } = v as { blocos?: unknown; documentos?: unknown };
  if (!Array.isArray(blocos)) return null;
  return {
    blocos: blocos.filter(
      (b): b is { bloco: string; texto: string } =>
        !!b && typeof b === 'object' && typeof b.bloco === 'string' && typeof b.texto === 'string'
    ),
    documentos: Array.isArray(documentos) ? documentos.filter((d): d is string => typeof d === 'string') : [],
  };
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
  /** Id → título dos documentos da base; `null` = a leitura falhou (mostra só a conta). */
  const [titulos, setTitulos] = useState<Map<string, string> | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [res, base] = await Promise.all([
        fetch(`/api/cb/ia/agentes/${agenteId}/turnos`, { cache: 'no-store' }),
        fetch('/api/ai/knowledge', { cache: 'no-store' })
          .then(async (r) => (r.ok ? ((await r.json()) as { documents?: { id: string; title: string }[] }) : null))
          .catch(() => null),
      ]);
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { turnos?: Array<Omit<Turno, 'contexto'> & { contexto?: unknown }> };
      setTitulos(base ? new Map((base.documents ?? []).map((d) => [d.id, d.title])) : null);
      setTurnos((corpo.turnos ?? []).map((x) => ({ ...x, contexto: lerContexto(x.contexto) })));
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
              {turno.contexto ? <RetratoDoTurno contexto={turno.contexto} titulos={titulos} /> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RetratoDoTurno({
  contexto,
  titulos,
}: {
  contexto: ContextoDoTurno;
  titulos: Map<string, string> | null;
}) {
  const t = useTranslations('IaAgentes');
  // Vários trechos podem vir do MESMO documento: o nome aparece uma vez.
  const documentos = [...new Set(contexto.documentos)];
  return (
    <details className="w-full text-xs">
      <summary className="inline-flex cursor-pointer items-center gap-1 text-muted-foreground hover:text-foreground">
        <Eye className="size-3.5" /> {t('turnos.contexto.titulo')}
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-2">
        {contexto.blocos.length === 0 ? (
          <p className="text-muted-foreground">{t('turnos.contexto.soAConversa')}</p>
        ) : (
          contexto.blocos.map((b, i) => (
            <div key={`${b.bloco}:${i}`} className="space-y-0.5">
              <p className="font-medium text-foreground">{rotuloDoBloco(t, b.bloco)}</p>
              <p className="break-words whitespace-pre-wrap text-muted-foreground">{b.texto}</p>
            </div>
          ))
        )}
        <div className="space-y-0.5">
          <p className="font-medium text-foreground">{t('turnos.contexto.base', { n: documentos.length })}</p>
          {titulos && documentos.length > 0 ? (
            <ul className="list-inside list-disc text-muted-foreground">
              {documentos.map((id) => (
                <li key={id} className="truncate">
                  {titulos.get(id) ?? t('turnos.contexto.documentoApagado')}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </details>
  );
}

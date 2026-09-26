'use client';

// ============================================================
// Agentes de IA → a LISTA (F1b do docs/PLANO-agentes-de-ia.md, 5.9).
//
// Um cartão por agente: nome, descrição, modelo, conexões e se está ligado.
// ⚠️ Nesta fase NENHUM agente responde cliente: "ligado" só passa a valer na
// F2, e o cartão diz isso. ⚠️ Lista vazia só vira "nenhum agente" quando a
// carga RESPONDEU; falha diz que falhou.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bot, Plus, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useChannels } from '@/hooks/use-channels';
import { cn } from '@/lib/utils';
import { NovoAgenteDialog } from './novo-agente-dialog';
import { NOME_DO_PROVEDOR, type IaAgente } from './tipos';

type Estado =
  | { fase: 'carregando' }
  | { fase: 'falhou' }
  | { fase: 'pronto'; agentes: IaAgente[] };

export function ListaDeAgentes() {
  const t = useTranslations('IaAgentes');
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [criando, setCriando] = useState(false);
  const { channels } = useChannels();

  const carregar = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/ia/agentes', { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const corpo = (await res.json()) as { agentes?: IaAgente[] };
      setEstado({ fase: 'pronto', agentes: corpo.agentes ?? [] });
    } catch {
      setEstado({ fase: 'falhou' });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await carregar();
    })();
  }, [carregar]);

  const nomeDaConexao = (id: string) => channels.find((c) => c.id === id)?.label ?? '—';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-sm text-muted-foreground">{t('lista.explicacao')}</p>
        <Button size="sm" onClick={() => setCriando(true)}>
          <Plus className="size-4" /> {t('lista.novo')}
        </Button>
      </div>

      {estado.fase === 'carregando' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </div>
      ) : estado.fase === 'falhou' ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t('lista.falhou')}</p>
          <Button variant="outline" size="sm" onClick={() => void carregar()}>
            <RefreshCw className="size-4" /> {t('tentarDeNovo')}
          </Button>
        </div>
      ) : estado.agentes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <Bot className="mx-auto mb-2 size-8 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{t('lista.vazia')}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {estado.agentes.map((a) => (
            <Link
              key={a.id}
              href={`/agents/${a.id}`}
              className="min-w-0 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="flex items-center gap-2">
                <Bot className="size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{a.nome}</span>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px]',
                    a.ativo
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {a.ativo ? t('lista.ligado') : t('lista.desligado')}
                </span>
              </div>
              {a.descricao ? (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.descricao}</p>
              ) : null}
              <p className="mt-2 truncate text-[11px] text-muted-foreground">
                {NOME_DO_PROVEDOR[a.provedor]} · <code>{a.modelo}</code>
              </p>
              <p className="mt-1 truncate text-[11px] text-muted-foreground">
                {a.conexoes.length === 0
                  ? t('lista.semConexao')
                  : t('lista.conexoes', { conexoes: a.conexoes.map(nomeDaConexao).join(', ') })}
              </p>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {t('lista.legado')}{' '}
        <Link href="/agents/legado" className="text-primary underline-offset-2 hover:underline">
          {t('lista.legadoLink')}
        </Link>
      </p>

      <NovoAgenteDialog aberto={criando} aoFechar={() => setCriando(false)} />
    </div>
  );
}

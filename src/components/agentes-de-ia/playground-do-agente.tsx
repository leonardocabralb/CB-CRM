'use client';

// O Playground de UM agente (F1b): o mesmo pedido e o mesmo modelo da
// produção, sem WhatsApp. O gasto conta como TESTE (D13). Testa o que está
// SALVO: mudança não salva na Configuração não vale aqui, e a tela diz isso.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Loader2, RotateCcw, Send, UserCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { IaAgente } from './tipos';
import { textoDoCodigo } from './textos';

interface Turno {
  role: 'user' | 'assistant';
  content: string;
  /** Só do agente: ele pediu transferência para gente neste turno. */
  handoff?: boolean;
  tokens?: number;
}

export function PlaygroundDoAgente({ agente }: { agente: IaAgente }) {
  const t = useTranslations('IaAgentes');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const rolagemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rolagemRef.current?.scrollTo({ top: rolagemRef.current.scrollHeight });
  }, [turnos, enviando]);

  async function enviar() {
    const conteudo = texto.trim();
    if (!conteudo || enviando) return;
    const proximos: Turno[] = [...turnos, { role: 'user', content: conteudo }];
    setTurnos(proximos);
    setTexto('');
    setEnviando(true);
    try {
      const res = await fetch(`/api/cb/ia/agentes/${agente.id}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: proximos.map((x) => ({ role: x.role, content: x.content })) }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        reply?: string;
        handoff?: boolean;
        usage?: { totalTokens?: number } | null;
        code?: string;
      };
      if (!res.ok) {
        toast.error(textoDoCodigo(t, corpo.code));
        setTurnos(turnos);
        setTexto(conteudo);
        return;
      }
      setTurnos([
        ...proximos,
        {
          role: 'assistant',
          content: typeof corpo.reply === 'string' ? corpo.reply : '',
          handoff: corpo.handoff === true,
          tokens: corpo.usage?.totalTokens ?? undefined,
        },
      ]);
    } catch {
      toast.error(t('erro.generico'));
      setTurnos(turnos);
      setTexto(conteudo);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">{t('playground.explicacao')}</p>
      <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {agente.nome} · <code className="text-xs text-muted-foreground">{agente.modelo}</code>
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTurnos([])}
            disabled={turnos.length === 0 || enviando}
            className="text-muted-foreground"
          >
            <RotateCcw className="mr-1.5 size-3.5" /> {t('playground.recomecar')}
          </Button>
        </div>

        <div ref={rolagemRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {turnos.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
              <Bot className="mb-2 size-8 text-muted-foreground/60" />
              <p>{t('playground.vazio')}</p>
            </div>
          ) : null}
          {turnos.map((x, i) => (
            <div key={i} className={cn('flex gap-2', x.role === 'user' ? 'justify-end' : 'justify-start')}>
              {x.role === 'assistant' ? <Bot className="mt-1 size-5 shrink-0 text-primary" /> : null}
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-3.5 py-2 text-sm',
                  x.role === 'user'
                    ? 'rounded-br-sm bg-primary text-primary-foreground'
                    : 'rounded-bl-sm bg-muted text-foreground'
                )}
              >
                {x.content ? <p className="whitespace-pre-wrap">{x.content}</p> : null}
                {x.role === 'assistant' && x.handoff ? (
                  <p
                    className={cn(
                      'flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300',
                      x.content && 'mt-1.5 border-t border-border/50 pt-1.5'
                    )}
                  >
                    <UserCircle2 className="size-3.5" /> {t('playground.transferiria')}
                  </p>
                ) : null}
                {x.role === 'assistant' && x.tokens !== undefined ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">{t('playground.tokens', { n: x.tokens })}</p>
                ) : null}
              </div>
              {x.role === 'user' ? <UserCircle2 className="mt-1 size-5 shrink-0 text-muted-foreground" /> : null}
            </div>
          ))}
          {enviando ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bot className="size-5 text-primary" />
              <Loader2 className="size-4 animate-spin" /> {t('playground.pensando')}
            </div>
          ) : null}
        </div>

        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={t('playground.placeholder')}
            rows={1}
            className="min-w-0 flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary/50"
          />
          <Button size="sm" onClick={() => void enviar()} disabled={!texto.trim() || enviando} className="size-9 shrink-0 p-0">
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}

'use client';

// O Playground de UM agente (F1b): o mesmo pedido e o mesmo modelo da
// produção, sem WhatsApp. O gasto conta como TESTE (D13). Testa o que está
// SALVO: mudança não salva na Configuração, no Acesso ou na Base não vale
// aqui, e a tela diz isso.
//
// F3: um cliente OPCIONAL — com ele, o agente vê os dados desse contato que
// estão marcados em Acesso; sem ele, só a conversa. Debaixo de cada resposta,
// o que o agente viu (os blocos e quantos trechos da base), que é o que
// responde "por que ele sabia disso?". O cliente escolhido mora no DETALHE:
// o salvamento que zera a conversa (a `key`) não o apaga. Trocar de cliente
// zera a conversa — a de um, mandada como se fosse do outro, não testa nada.

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Bot, Eye, Loader2, RotateCcw, Send, UserCircle2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SeletorDeContatoRemoto } from '@/components/contacts/seletor-de-contato-remoto';
import { TETO_DE_RESULTADOS } from '@/lib/contacts/busca-remota';
import { cn } from '@/lib/utils';
import type { IaAgente } from './tipos';
import { rotuloDoBloco, textoDoCodigo } from './textos';

/** O que o agente viu para gerar a resposta (`vistos` da rota). */
interface Vistos {
  blocos: string[];
  documentos: number;
}

/** Parse, nunca `as`: resposta estranha vira "não se sabe" (nada é mostrado). */
function lerVistos(v: unknown): Vistos | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { blocos, documentos } = v as { blocos?: unknown; documentos?: unknown };
  if (!Array.isArray(blocos) || typeof documentos !== 'number') return undefined;
  return { blocos: blocos.filter((b): b is string => typeof b === 'string'), documentos };
}

interface Turno {
  role: 'user' | 'assistant';
  content: string;
  /** Só do agente: ele pediu transferência para gente neste turno. */
  handoff?: boolean;
  /** Só do agente: ele passaria a conversa para este agente (D25). */
  passaPara?: string;
  tokens?: number;
  /** Só do agente: o que ele viu (F3). */
  vistos?: Vistos;
}

export function PlaygroundDoAgente({
  agente,
  naoSalvoEm,
  contatoId,
  aoMudarContato,
}: {
  agente: IaAgente;
  /** Os nomes das abas com alteração não salva — o Playground testa o SALVO. */
  naoSalvoEm: string[];
  /** O cliente do teste; `''` = nenhum (só a conversa). */
  contatoId: string;
  aoMudarContato: (id: string) => void;
}) {
  const t = useTranslations('IaAgentes');
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const rolagemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rolagemRef.current?.scrollTo({ top: rolagemRef.current.scrollHeight });
  }, [turnos, enviando]);

  function trocarContato(id: string) {
    if (id === contatoId) return;
    aoMudarContato(id);
    setTurnos([]);
  }

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
        body: JSON.stringify({
          messages: proximos.map((x) => ({ role: x.role, content: x.content })),
          ...(contatoId ? { contactId: contatoId } : {}),
        }),
      });
      const corpo = (await res.json().catch(() => ({}))) as {
        reply?: string;
        handoff?: boolean;
        passaPara?: string | null;
        usage?: { totalTokens?: number } | null;
        vistos?: unknown;
        code?: string;
        error?: string;
      };
      if (!res.ok) {
        toast.error(textoDoCodigo(t, corpo.code, corpo.error));
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
          passaPara: typeof corpo.passaPara === 'string' ? corpo.passaPara : undefined,
          tokens: corpo.usage?.totalTokens ?? undefined,
          vistos: lerVistos(corpo.vistos),
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
      {naoSalvoEm.length > 0 ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {t('playground.naoSalvo', { abas: naoSalvoEm.join(', ') })}
        </p>
      ) : null}
      <div className="space-y-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm text-foreground">{t('playground.contato')}</span>
          <div className="min-w-0 flex-1 sm:max-w-xs">
            <SeletorDeContatoRemoto
              value={contatoId}
              onChange={trocarContato}
              disabled={enviando}
              placeholder={t('playground.contatoNenhum')}
              searchPlaceholder={t('playground.contatoBuscar')}
              hintText={t('playground.contatoAjuda')}
              loadingText={t('playground.carregandoContatos')}
              emptyText={t('playground.contatoVazio')}
              failedText={t('playground.contatoFalhou')}
              moreText={t('playground.contatoMais', { count: TETO_DE_RESULTADOS })}
              ariaLabel={t('playground.contato')}
            />
          </div>
          {contatoId ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={enviando}
              aria-label={t('playground.limparContato')}
              title={t('playground.limparContato')}
              onClick={() => trocarContato('')}
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">{t('playground.contatoDica')}</p>
      </div>
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
                  // `min-w-0` + `break-words`: um link longo (o do boleto,
                  // justo o que o agente de cobrança manda) não vaza da bolha.
                  'min-w-0 max-w-[80%] break-words rounded-2xl px-3.5 py-2 text-sm',
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
                {x.role === 'assistant' && x.passaPara ? (
                  <p className="flex items-center gap-1 text-xs text-primary">
                    <Bot className="size-3.5" /> {t('playground.passaria', { agente: x.passaPara })}
                  </p>
                ) : null}
                {x.role === 'assistant' && x.vistos ? (
                  <p className="mt-1.5 flex items-start gap-1 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
                    <Eye className="mt-px size-3 shrink-0" />
                    <span>
                      {t('playground.viu', {
                        itens: [t('playground.conversa'), ...x.vistos.blocos.map((b) => rotuloDoBloco(t, b))].join(', '),
                        trechos: t('playground.trechos', { n: x.vistos.documentos }),
                      })}
                    </span>
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

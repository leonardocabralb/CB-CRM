'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Copy, ExternalLink, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { Button, buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { carregarReuniaoTranscrita } from '@/hooks/use-reunioes-transcritas';
import { FUSO_PADRAO, diaNoFuso, horaNoFuso } from '@/lib/agenda/fuso';
import { formatarDuracao, tempoMmSs } from '@/lib/tldv/texto';
import type { ReuniaoTranscrita } from '@/types';

/**
 * A transcrição inteira de uma reunião (987), num diálogo. Busca a linha
 * COMPLETA por id ao abrir — a lista da ficha não carrega o texto.
 *
 * Ações (todas do dono do estado, que decide o que pode): abrir no tl;dv,
 * copiar o texto, buscar de novo (reunião do tl;dv sem transcrição),
 * desvincular (tl;dv) ou excluir (manual).
 */

interface Props {
  id: string | null;
  aberto: boolean;
  aoFechar: () => void;
  podeEditar: boolean;
  /** Decide POR LINHA: manual do autor (ou admin) pode excluir. */
  podeExcluir: (r: ReuniaoTranscrita) => boolean;
  /** Algo mudou (desvinculou, excluiu, buscou de novo): a lista recarrega. */
  aoMudar: () => void;
}

const MOTIVOS = new Set([
  'nao_conectado',
  'nao_encontrado',
  'sem_permissao',
  'limite',
  'rede',
  'tldv_error',
  'db_error',
  'chave_invalida',
  'chave_ilegivel',
  'so_tldv',
  'so_manual',
]);

export function TranscricaoDialog({ id, aberto, aoFechar, podeEditar, podeExcluir, aoMudar }: Props) {
  const t = useTranslations('Transcricoes');
  const [reuniao, setReuniao] = useState<ReuniaoTranscrita | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const motivo = (codigo: string) =>
    MOTIVOS.has(codigo) ? t(`motivo.${codigo}` as Parameters<typeof t>[0]) : t('motivo.tldv_error');

  useEffect(() => {
    if (!aberto || !id) return;
    let vivo = true;
    // A linha do diálogo anterior não pode ficar sob o título do novo.
    setReuniao(null);
    setCarregando(true);
    void carregarReuniaoTranscrita(id).then((r) => {
      if (!vivo) return;
      setReuniao(r);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [aberto, id]);

  const copiar = async () => {
    if (!reuniao?.texto) return;
    try {
      await navigator.clipboard.writeText(reuniao.texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error(t('copiarFalhou'));
    }
  };

  const buscarDeNovo = async () => {
    if (!reuniao || ocupado) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/cb/reunioes-transcritas/${reuniao.id}/reprocessar`, { method: 'POST' });
      const corpo = (await res.json().catch(() => ({}))) as { error?: string; status?: string };
      if (!res.ok) {
        toast.error(t('falha', { motivo: motivo(corpo.error ?? 'tldv_error') }));
        return;
      }
      toast.success(corpo.status === 'pronta' ? t('buscouPronta') : t('buscouAindaNao'));
      aoMudar();
      const r = await carregarReuniaoTranscrita(reuniao.id);
      if (r) setReuniao(r);
    } finally {
      setOcupado(false);
    }
  };

  const desvincular = async () => {
    if (!reuniao || ocupado) return;
    if (!window.confirm(t('confirmarDesvincular'))) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/cb/reunioes-transcritas/${reuniao.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: null }),
      });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(t('falha', { motivo: motivo(corpo.error ?? 'db_error') }));
        return;
      }
      toast.success(t('desvinculada'));
      aoMudar();
      aoFechar();
    } finally {
      setOcupado(false);
    }
  };

  const excluir = async () => {
    if (!reuniao || ocupado) return;
    if (!window.confirm(t('confirmarExcluir'))) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/cb/reunioes-transcritas/${reuniao.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(t('falha', { motivo: motivo(corpo.error ?? 'db_error') }));
        return;
      }
      toast.success(t('excluida'));
      aoMudar();
      aoFechar();
    } finally {
      setOcupado(false);
    }
  };

  const inicio = reuniao ? new Date(reuniao.realizada_em) : null;
  const segmentos = reuniao?.segmentos ?? null;

  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && aoFechar()}>
      {/* ⚠️ `max-h` + `flex-col` + a área rolável com `min-h-0`: o
          `DialogContent` deste projeto não tem teto de altura, e uma
          transcrição de uma hora cresceria para fora da viewport. O
          `min-w-0` no filho é o que deixa o `truncate` do título funcionar
          (CLAUDE.md, armadilhas de layout). */}
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="truncate pr-6">{reuniao?.titulo ?? t('titulo')}</DialogTitle>
          <DialogDescription>
            {reuniao && inicio ? (
              <>
                {diaNoFuso(inicio, FUSO_PADRAO)} · {horaNoFuso(inicio, FUSO_PADRAO)} · {formatarDuracao(reuniao.duracao_seg)} ·{' '}
                {reuniao.origem === 'tldv' ? t('origemTldv') : t('origemManual')}
                {reuniao.origem === 'manual' && reuniao.autor_nome ? ` · ${t('porAutor', { nome: reuniao.autor_nome })}` : ''}
              </>
            ) : (
              t('carregando')
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1 text-sm">
          {carregando ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t('carregando')}
            </p>
          ) : !reuniao ? (
            <p className="text-muted-foreground">{t('naoEncontrada')}</p>
          ) : (
            <div className="space-y-4">
              {reuniao.participantes.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{t('participantes')}:</span>{' '}
                  {reuniao.participantes.map((p) => p.nome || p.email).filter(Boolean).join(', ')}
                  {reuniao.organizador_nome ? ` · ${t('organizador')}: ${reuniao.organizador_nome}` : ''}
                </p>
              )}

              {reuniao.status !== 'pronta' && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  {t(`status.${reuniao.status}` as Parameters<typeof t>[0])}
                  {reuniao.erro ? ` — ${motivo(reuniao.erro)}` : ''}
                  {reuniao.status === 'pendente' ? ` ${t('pendenteAjuda')}` : ''}
                </p>
              )}

              {reuniao.notas && (
                <details className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium">{t('notas')}</summary>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed">{reuniao.notas}</pre>
                </details>
              )}

              {segmentos && segmentos.length > 0 ? (
                <ol className="space-y-2">
                  {segmentos.map((s, i) => (
                    <li key={i} className="grid grid-cols-[3.5rem_1fr] gap-2">
                      <span className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">{tempoMmSs(s.inicioSeg)}</span>
                      <p className="leading-relaxed">
                        {s.orador && <span className="font-medium">{s.orador}: </span>}
                        {s.texto}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : reuniao.texto ? (
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{reuniao.texto}</pre>
              ) : null}
            </div>
          )}
        </div>

        {reuniao && (
          <DialogFooter className="flex-wrap gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {reuniao.url && (
                <a
                  href={reuniao.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                >
                  <ExternalLink className="size-3.5" />
                  {reuniao.origem === 'tldv' ? t('abrirNoTldv') : t('abrirLink')}
                </a>
              )}
              {reuniao.texto && (
                <Button type="button" variant="outline" size="sm" onClick={() => void copiar()}>
                  {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copiado ? t('copiado') : t('copiar')}
                </Button>
              )}
            </div>
            {podeEditar && (
              <div className="flex flex-wrap gap-2">
                {reuniao.origem === 'tldv' && reuniao.status !== 'pronta' && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void buscarDeNovo()} disabled={ocupado}>
                    <RefreshCw className={ocupado ? 'size-3.5 animate-spin' : 'size-3.5'} />
                    {t('buscarDeNovo')}
                  </Button>
                )}
                {reuniao.origem === 'tldv' && reuniao.contact_id && (
                  <Button type="button" variant="outline" size="sm" onClick={() => void desvincular()} disabled={ocupado}>
                    {t('desvincular')}
                  </Button>
                )}
                {reuniao.origem === 'manual' && podeExcluir(reuniao) && (
                  <Button type="button" variant="destructive" size="sm" onClick={() => void excluir()} disabled={ocupado}>
                    {t('excluir')}
                  </Button>
                )}
              </div>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Loader2, RotateCcw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { identidadeDoContato, nomeDoContato } from '@/lib/contacts/identidade';
import { diasRestantes, type ItemDaLixeira } from '@/lib/contacts/lixeira';
import { cn } from '@/lib/utils';

/** O item como "contato" para as réguas de identidade — sem o BSUID, que a
 *  lista nem recebe (`cb_lixeira_da_conta` não o devolve). */
export function contatoDoItem(item: ItemDaLixeira) {
  return {
    name: item.nome,
    phone: item.telefone,
    wa_username: item.waUsername,
    instagram_username: item.instagramUsername,
  };
}

/** Data e hora no idioma do navegador; ilegível vira travessão. A faixa
 *  "Há uma ficha desta pessoa na Lixeira" (1101) usa a mesma. */
export function quandoLegivel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/**
 * Uma ficha na Lixeira: quem é, quem moveu e quando, quanto falta para sair
 * de vez, o que ela guarda, e as ações.
 *
 * ⚠️ B2: com a identidade já em outra ficha, Restaurar fica DESABILITADO e a
 * linha diz de quem é, com o link — o banco recusaria do mesmo jeito, mas a
 * pessoa precisa saber ANTES o que resolver.
 */
export function ItemDaLixeiraLinha({
  item,
  agora,
  fichasNoLote,
  ocupado,
  emAcao,
  aoRestaurar,
  aoRestaurarLote,
  aoExcluir,
}: {
  item: ItemDaLixeira;
  /** Relógio por tique de quem desenha a lista (o React Compiler recusa
   *  `Date.now()` no render). */
  agora: number;
  /** Quantas fichas DESTE lote estão na lista desenhada. */
  fichasNoLote: number;
  /** Alguma ação da Lixeira está em voo: os botões esperam. */
  ocupado: boolean;
  /** É ESTE item (ou o lote dele) que está em voo. */
  emAcao: boolean;
  aoRestaurar: () => void;
  aoRestaurarLote: () => void;
  aoExcluir: () => void;
}) {
  const t = useTranslations('Contacts.lixeira');
  const contato = contatoDoItem(item);
  const nome = nomeDoContato(contato, t('semNome'));
  const identidade = identidadeDoContato(contato);
  const dias = diasRestantes(item.venceEm, agora);
  const bloqueada = item.ocupadaPor !== null;
  const c = item.contagens;

  const contagens = [
    (c.messages ?? 0) > 0 ? t('tela.contagemMensagens', { count: c.messages }) : null,
    (c.cb_tasks ?? 0) > 0 ? t('tela.contagemTarefas', { count: c.cb_tasks }) : null,
    (c.cb_conversation_notes ?? 0) > 0
      ? t('tela.contagemAnotacoes', { count: c.cb_conversation_notes })
      : null,
    (c.cb_scheduled_messages ?? 0) > 0
      ? t('tela.contagemAgendadas', { count: c.cb_scheduled_messages })
      : null,
  ].filter((x): x is string => x !== null);

  return (
    <li className="min-w-0 rounded-lg border border-border bg-card p-3 sm:p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="font-medium break-words text-foreground">{nome}</p>
          {item.nome && identidade && (
            <p className="text-xs break-all text-muted-foreground">{identidade}</p>
          )}
          {item.email && <p className="text-xs break-all text-muted-foreground">{item.email}</p>}
          <p className="text-xs text-muted-foreground">
            {item.movidaPorNome
              ? t('tela.movidaPor', { quem: item.movidaPorNome, quando: quandoLegivel(item.movidaEm) })
              : t('tela.movidaEm', { quando: quandoLegivel(item.movidaEm) })}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                dias <= 7
                  ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {dias === 0 ? t('tela.vencida') : t('tela.diasRestantes', { dias })}
            </span>
            {contagens.map((texto) => (
              <span
                key={texto}
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {texto}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={aoRestaurar}
            disabled={ocupado || bloqueada}
            title={bloqueada ? t('tela.restaurarBloqueado') : undefined}
          >
            {emAcao ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            {t('tela.restaurar')}
          </Button>
          {fichasNoLote > 1 && (
            <Button
              variant="outline"
              size="sm"
              onClick={aoRestaurarLote}
              disabled={ocupado}
              title={t('tela.restaurarLoteDica', { count: fichasNoLote })}
            >
              <RotateCcw className="size-3.5" />
              {t('tela.restaurarLote', { count: fichasNoLote })}
            </Button>
          )}
          <Button variant="destructive" size="sm" onClick={aoExcluir} disabled={ocupado}>
            <Trash2 className="size-3.5" />
            {t('tela.excluirAgora')}
          </Button>
        </div>
      </div>

      {bloqueada && (
        <div className="mt-3 flex min-w-0 items-start gap-2 rounded-md border border-amber-600/30 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0 space-y-1">
            <p className="break-words">
              {t('tela.ocupada', { nome: item.ocupadaPorNome ?? t('semNome') })}{' '}
              <Link
                href={`/contacts?contact=${item.ocupadaPor}`}
                className="font-medium underline underline-offset-2"
              >
                {t('tela.abrirFicha')}
              </Link>
            </p>
            <p>{t('tela.restaurarBloqueado')}</p>
          </div>
        </div>
      )}
    </li>
  );
}

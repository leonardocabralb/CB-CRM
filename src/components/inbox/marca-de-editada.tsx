'use client';

import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';

/**
 * A marca "editada" da anotação interna (Fase 3; A4 do operador: a marca com
 * a hora, sem guardar versões), ao lado da hora em que ela foi escrita, com a
 * hora da EDIÇÃO no `title`. Nos CINCO lugares que desenham a anotação — o
 * fio, as abas, a faixa da fixada, a citação e a ficha de `/contatos` (pino
 * `anexos-da-nota.chamadores.test.ts`: quem desenha o texto desenha a marca).
 * Nunca editada (`editada_em` nulo), nada.
 */
export function MarcaDeEditada({
  editadaEm,
  className,
}: {
  /** `nota.editada_em`. */
  editadaEm: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations('Inbox.note');
  if (!editadaEm) return null;
  const quando = new Date(editadaEm);
  if (Number.isNaN(quando.getTime())) return null;
  // Locale do NAVEGADOR (undefined), como a data da anotação ao lado.
  const titulo = t('editadaEm', {
    quando: quando.toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  });
  return (
    <span title={titulo} className={cn('italic', className)}>
      {t('editada')}
      <span className="sr-only"> ({titulo})</span>
    </span>
  );
}

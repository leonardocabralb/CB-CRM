'use client';

import { useTranslations } from 'next-intl';

import { quandoFoiEditada } from '@/lib/notes/edicao';
import { cn } from '@/lib/utils';

/**
 * A marca "editada" da anotação interna (Fase 3; A4 do operador: a marca com
 * a hora, sem guardar versões), ao lado da hora em que ela foi escrita. A hora
 * da EDIÇÃO fica VISÍVEL ("editada 20:02"; noutro dia, "editada 24/10, 09:15"
 * — `quandoFoiEditada`): decisão do operador (23/10/2026), porque no celular
 * não há `title`. A data completa fica no `title`. Nos CINCO lugares que
 * desenham a anotação — o fio, as abas, a faixa da fixada, a citação e a
 * ficha de `/contatos` (pino `anexos-da-nota.chamadores.test.ts`: quem desenha
 * o texto desenha a marca). Nunca editada (`editada_em` nulo), nada.
 */
export function MarcaDeEditada({
  editadaEm,
  criadaEm,
  className,
}: {
  /** `nota.editada_em`. */
  editadaEm: string | null | undefined;
  /** `nota.created_at`: editada no mesmo dia, a marca mostra só a hora. */
  criadaEm: string | null | undefined;
  className?: string;
}) {
  const t = useTranslations('Inbox.note');
  if (!editadaEm) return null;
  // Locale e fuso do NAVEGADOR (undefined), como a data da anotação ao lado.
  const quando = quandoFoiEditada(editadaEm, criadaEm);
  if (!quando) return null;
  const titulo = t('editadaEm', {
    quando: new Date(editadaEm).toLocaleString(undefined, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
  });
  return (
    <span title={titulo} className={cn('italic', className)}>
      {t('editada', { quando })}
    </span>
  );
}

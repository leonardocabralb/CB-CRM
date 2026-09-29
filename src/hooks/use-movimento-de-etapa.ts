'use client';

import { useEffect, useSyncExternalStore } from 'react';

import {
  assinarMovimentos,
  type EstadoDoMovimento,
  fotoDoMovimento,
  retomarMovimentosPendentes,
} from '@/lib/pipelines/mover-com-desfazer';

/**
 * O movimento de etapa com desfazer de um negócio: aguardando (com o
 * prazo), enviando, ou o aviso recente ("movido", "desfeito"). `null` =
 * nada acontecendo. O estado vive fora do React (o botão pode desmontar com
 * o pedido no ar) — ver `src/lib/pipelines/mover-com-desfazer.ts`.
 */
export function useMovimentoDeEtapa(dealId: string | null | undefined): EstadoDoMovimento | null {
  return useSyncExternalStore(
    assinarMovimentos,
    () => fotoDoMovimento(dealId),
    () => null,
  );
}

/**
 * Refaz os movimentos que ficaram guardados no aparelho sem resposta do
 * servidor (a página fechou no meio, sem conexão). A CASCA do app chama, para
 * valer em qualquer página que a pessoa abra primeiro.
 */
export function useRetomarMovimentosPendentes(userId: string | null | undefined): void {
  useEffect(() => {
    if (userId) retomarMovimentosPendentes(userId);
  }, [userId]);
}

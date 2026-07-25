'use client';

// ============================================================
// Os canais de WhatsApp da conta, para o browser.
//
// Antes disto o mesmo `fetch('/api/cb/channels')` estava copiado em quatro
// telas (lista de conversas, thread, gestor de modelos, visão geral de
// ajustes) e a Fase F ia levar isso para uma dúzia. Cada cópia repetia o
// mesmo cuidado — flag de cancelamento e catch mudo — e cada nova cópia
// era uma chance de esquecer um dos dois.
//
// O silêncio no erro é deliberado e vem das cópias originais: conta sem
// canais, deploy anterior à migration 901, ou rede caindo devolvem lista
// vazia, e TODA tela que usa este hook trata lista vazia escondendo o
// seletor e se comportando como no mundo de um número só. Nenhuma tela
// fica quebrada por não conseguir listar canais.
// ============================================================

import { useEffect, useState } from 'react';

import type { CbChannel } from '@/lib/cb-channels/repo';

export interface UseChannelsResult {
  channels: CbChannel[];
  /** `true` até a primeira resposta chegar (ou falhar). */
  loading: boolean;
}

export function useChannels(): UseChannelsResult {
  const [channels, setChannels] = useState<CbChannel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch('/api/cb/channels');
        if (!res.ok) return;
        const payload = await res.json();
        if (!cancelado) setChannels((payload.channels ?? []) as CbChannel[]);
      } catch {
        // Sem canais a tela se comporta como antes do multi-canal.
      } finally {
        if (!cancelado) setLoading(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  return { channels, loading };
}

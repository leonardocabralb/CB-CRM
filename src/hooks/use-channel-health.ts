'use client';

// ============================================================
// A saúde das conexões, para o cabeçalho.
//
// Dois mecanismos, e cada um cobre o que o outro não vê:
//
//  · POLLING (30s) — o único que detecta MORTE SILENCIOSA. Servidor
//    Evolution fora do ar não emite evento nenhum; sem alguém perguntando,
//    a tela ficaria verde para sempre.
//  · REALTIME — o webhook `connection.update` já grava `cb_channels`, e a
//    tabela entrou na publicação na 909. Uma queda avisada pelo provedor
//    vira vermelho em menos de um segundo em vez de esperar o ciclo.
//
// Aba oculta não pede nada: o indicador só importa para quem está olhando.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

export type HealthTone = 'ok' | 'warn' | 'down' | 'unknown';

export interface ChannelHealth {
  id: string;
  label: string;
  kind: 'meta' | 'evolution';
  phone: string | null;
  isDefault: boolean;
  tone: HealthTone;
  status: 'disconnected' | 'connecting' | 'connected';
  connectedAt: string | null;
  checkedAt: string | null;
  detail: string | null;
  webhookOk: boolean | null;
}

const POLL_MS = 30_000;
/** Depois de uma falha, espaça — servidor fora do ar não melhora em 30s. */
const BACKOFF_MAX_MS = 5 * 60_000;

export function useChannelHealth(): { channels: ChannelHealth[]; loading: boolean } {
  const [channels, setChannels] = useState<ChannelHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const falhasRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivoRef = useRef(true);
  /** A primeira busca ignora a visibilidade da aba — ver `tick`. */
  const primeiraRef = useRef(true);

  const buscar = useCallback(async () => {
    try {
      const res = await fetch('/api/cb/channels/health', { cache: 'no-store' });
      if (!res.ok) {
        falhasRef.current++;
        return;
      }
      const payload = await res.json();
      if (!vivoRef.current) return;
      falhasRef.current = 0;
      setChannels((payload.channels ?? []) as ChannelHealth[]);
    } catch {
      // Silêncio deliberado, igual ao `use-channels`: conta sem canais,
      // deploy anterior à migration ou rede caindo devolvem lista vazia, e
      // lista vazia esconde o indicador. Nenhuma tela quebra por isso.
      falhasRef.current++;
    } finally {
      if (vivoRef.current) setLoading(false);
    }
  }, []);

  // Laço de polling. Reagenda a si mesmo em vez de usar setInterval: assim o
  // backoff funciona e duas respostas lentas não empilham requisições.
  useEffect(() => {
    vivoRef.current = true;

    const agendar = () => {
      const espera = Math.min(POLL_MS * 2 ** falhasRef.current, BACKOFF_MAX_MS);
      timerRef.current = setTimeout(tick, espera);
    };
    const tick = async () => {
      // ⚠️ A PRIMEIRA busca sempre roda, mesmo com a aba oculta. Abrir o CRM
      // em nova aba em segundo plano — coisa de todo dia — entrega
      // `visibilityState: 'hidden'` no primeiro render; pular aqui deixava o
      // indicador vazio até alguém focar a aba, e sem nunca sair do estado de
      // carregamento (o `setLoading(false)` mora dentro de `buscar`).
      // Só o POLLING seguinte é que respeita a aba oculta.
      if (primeiraRef.current || document.visibilityState === 'visible') {
        primeiraRef.current = false;
        await buscar();
      }
      if (vivoRef.current) agendar();
    };

    void tick();

    // Voltar para a aba é o momento em que o dado velho mais engana — o
    // operador olha o indicador justamente aí.
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void buscar();
    };
    document.addEventListener('visibilitychange', aoVoltar);
    window.addEventListener('focus', aoVoltar);

    return () => {
      vivoRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', aoVoltar);
      window.removeEventListener('focus', aoVoltar);
    };
  }, [buscar]);

  // Realtime: o webhook grava `cb_channels` e nós refazemos a sonda. Não
  // aplicamos o payload direto de propósito — ele traz `status` cru, e a cor
  // depende também do frescor, que só a rota sabe compor.
  useEffect(() => {
    const supabase = createClient();
    const canal = supabase
      .channel('cb-channels-health')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cb_channels' },
        () => {
          if (document.visibilityState === 'visible') void buscar();
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(canal);
    };
  }, [buscar]);

  return { channels, loading };
}

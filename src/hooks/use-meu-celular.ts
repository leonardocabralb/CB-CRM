'use client';

import { useCallback, useEffect, useState } from 'react';

import { celularDigitado, ehMotivoDoCelular, type MotivoDoCelular } from '@/lib/account/celular';
import { createClient } from '@/lib/supabase/client';

// ============================================================
// O celular de QUEM ESTÁ LOGADO (`cb_celulares_dos_membros`, 1046).
//
// Lido direto sob RLS: a policy deixa a pessoa ler a própria linha. ⚠️ O
// `.eq('user_id', …)` é load-bearing: um ADMINISTRADOR também lê o celular da
// equipe, e sem o filtro o `maybeSingle()` estouraria com várias linhas — a
// tela de exigência leria isso como "não sei" e deixaria passar.
//
// ⚠️ `desconhecido` (a leitura FALHOU) é distinto de `falta` (a leitura
// respondeu que não há linha). A tela de exigência só se põe na frente com
// `falta`: bloquear o CRM inteiro por um soluço de rede seria a forma da
// issue #471. Quem não conseguiu ser conferido é pedido na próxima abertura.
//
// ⚠️ A leitura é CARIMBADA com o usuário (`de`): na troca de pessoa na mesma
// aba, a resposta do anterior vale "carregando", nunca a afirmação dele.
// ============================================================

export type EstadoDoMeuCelular = 'carregando' | 'tem' | 'falta' | 'desconhecido';

interface Leitura {
  de: string;
  estado: Exclude<EstadoDoMeuCelular, 'carregando'>;
  celular: string | null;
}

export interface MeuCelular {
  estado: EstadoDoMeuCelular;
  /** Os dígitos gravados (com o código do país), quando `estado === 'tem'`. */
  celular: string | null;
  /** Depois de um `salvarMeuCelular` bem-sucedido: a tela passa a saber sem ler de novo. */
  gravado: (celular: string) => void;
  /** Lê de novo (o "tentar de novo" de quem viu `desconhecido`). */
  recarregar: () => void;
}

export function useMeuCelular(userId: string | null): MeuCelular {
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    (async () => {
      const { data, error } = await createClient()
        .from('cb_celulares_dos_membros')
        .select('celular')
        .eq('user_id', userId)
        .maybeSingle();
      if (!vivo) return;
      if (error) {
        console.error('[useMeuCelular] leitura falhou:', { code: error.code, message: error.message });
        setLeitura({ de: userId, estado: 'desconhecido', celular: null });
        return;
      }
      setLeitura({
        de: userId,
        estado: data ? 'tem' : 'falta',
        celular: (data?.celular as string | undefined) ?? null,
      });
    })();
    return () => {
      vivo = false;
    };
  }, [userId, versao]);

  const gravado = useCallback(
    (celular: string) => {
      if (userId) setLeitura({ de: userId, estado: 'tem', celular });
    },
    [userId],
  );

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  const valida = leitura && leitura.de === userId ? leitura : null;
  return {
    estado: valida?.estado ?? 'carregando',
    celular: valida?.celular ?? null,
    gravado,
    recarregar,
  };
}

export type ResultadoDoSalvar =
  | { ok: true; celular: string }
  | { ok: false; motivo: MotivoDoCelular | 'falhou' };

/**
 * Grava o celular de quem está logado pela rota (a única porta de escrita).
 * Confere antes com a MESMA régua da rota, para a resposta ser imediata; o
 * 400 da rota volta com o motivo dela.
 */
export async function salvarMeuCelular(texto: string): Promise<ResultadoDoSalvar> {
  const local = celularDigitado(texto);
  if (!local.ok) return local;
  try {
    const res = await fetch('/api/cb/meu-celular', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ celular: texto }),
    });
    const json = (await res.json().catch(() => null)) as { celular?: unknown; error?: unknown } | null;
    if (res.ok && typeof json?.celular === 'string') return { ok: true, celular: json.celular };
    if (res.status === 400 && ehMotivoDoCelular(json?.error)) return { ok: false, motivo: json.error };
    return { ok: false, motivo: 'falhou' };
  } catch {
    return { ok: false, motivo: 'falhou' };
  }
}

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
// O contrato de erro tem DUAS metades, e a diferença é o achado #06:
//
//  - `channels: []` continua sendo o comportamento de sempre no erro: toda
//    tela que usa a lista para rótulo/filtro esconde o seletor e se comporta
//    como no mundo de um número só. Vazio-durante-a-falha é cosmético ali.
//  - `falhou` existe para o consumidor que converte a lista numa AFIRMAÇÃO
//    (a janela de 24h do fio, o "sem conexão" do diálogo de nova conversa,
//    o recorte de privacidade do Radar). Para esses, "não consegui
//    perguntar" e "a conta não tem canal" são respostas OPOSTAS — e antes
//    deste campo elas eram byte por byte o mesmo estado.
//
// ⚠️ A rota devolve 200 com `{ channels: [], unavailable: true }` quando o
// banco falha (o ramo pré-migration). Isso É falha para o consumidor grave —
// jogá-la fora reabriria o caminho 200-com-erro do achado #06.
//
// O cache de módulo existe pelo M14: a carga do inbox monta 3 consumidores
// (lista, fio, faixa de agendadas) e cada um disparava o MESMO GET. Um vôo
// compartilhado + validade curta colapsam a rajada sem deixar a lista
// envelhecer numa navegação Settings → inbox (conectou canal novo, voltou).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CbChannel } from '@/lib/cb-channels/repo';

export interface UseChannelsResult {
  channels: CbChannel[];
  /** `true` até a primeira resposta chegar (ou falhar). */
  loading: boolean;
  /**
   * `true` quando a última tentativa NÃO trouxe uma lista confiável (rede,
   * não-200, ou o `unavailable: true` que a rota devolve com 200). Quem só
   * usa a lista para rótulo pode ignorar; quem AFIRMA algo a partir do vazio
   * precisa conferir isto antes (#06).
   */
  falhou: boolean;
  /** Busca de novo, ignorando o cache — a saída do "tentar de novo" (#08). */
  recarregar: () => Promise<void>;
}

interface Resultado {
  channels: CbChannel[];
  falhou: boolean;
}

/**
 * Traduz a resposta da rota no resultado do hook. Pura e exportada para o
 * teste fixar as três formas de falha (não-200, `unavailable`, corpo torto).
 */
export function resultadoDaResposta(ok: boolean, payload: unknown): Resultado {
  if (!ok) return { channels: [], falhou: true };
  const corpo = payload as { channels?: unknown; unavailable?: unknown } | null;
  if (corpo?.unavailable === true) return { channels: [], falhou: true };
  if (!Array.isArray(corpo?.channels)) return { channels: [], falhou: true };
  return { channels: corpo.channels as CbChannel[], falhou: false };
}

// ---- cache de módulo (M14) --------------------------------------------
// Só o browser escreve aqui (o fetch vive em efeito/callback), então não há
// estado compartilhado entre usuários no SSR.

/** Curto de propósito: colapsa a rajada da montagem do inbox e nada mais. */
const VALIDADE_MS = 15_000;

let cache: { em: number; resultado: Resultado } | null = null;
let emVoo: Promise<Resultado> | null = null;

async function buscar(): Promise<Resultado> {
  try {
    const res = await fetch('/api/cb/channels');
    const payload = res.ok ? await res.json().catch(() => null) : null;
    return resultadoDaResposta(res.ok, payload);
  } catch {
    return { channels: [], falhou: true };
  }
}

function obter(forcar: boolean): Promise<Resultado> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_MS) {
    return Promise.resolve(cache.resultado);
  }
  if (!emVoo) {
    emVoo = buscar().then((r) => {
      // Falha NÃO entra no cache: a próxima montagem tenta de novo em vez
      // de repetir "falhou" por 15s a quem acabou de abrir a tela.
      if (!r.falhou) cache = { em: Date.now(), resultado: r };
      emVoo = null;
      return r;
    });
  }
  return emVoo;
}

export function useChannels(): UseChannelsResult {
  // Nasce nulo SEMPRE (mesmo com cache quente): o initializer roda também na
  // hidratação, e um valor que o servidor não tinha divergiria do HTML.
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const montadoRef = useRef(true);

  useEffect(() => {
    montadoRef.current = true;
    // Cache quente resolve num microtask — o `loading` inicial não chega a
    // pintar, e o setState fica assíncrono (regra do React Compiler).
    void obter(false).then((r) => {
      if (montadoRef.current) setResultado(r);
    });
    return () => {
      montadoRef.current = false;
    };
  }, []);

  const recarregar = useCallback(async () => {
    const r = await obter(true);
    if (montadoRef.current) setResultado(r);
  }, []);

  return {
    channels: resultado?.channels ?? SEM_CANAIS,
    loading: resultado === null,
    falhou: resultado?.falhou ?? false,
    recarregar,
  };
}

// Identidade estável para o estado "ainda não carregou" — cada render
// devolvendo um `[]` novo re-renderizaria os memos de todo consumidor.
const SEM_CANAIS: CbChannel[] = [];

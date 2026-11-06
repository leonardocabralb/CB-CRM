"use client";

// ============================================================
// Quem é CLIENTE IDEAL (1124) — as leituras das telas.
//
// `useClientesIdeais`: o mapa contato → nível da conta INTEIRA, UMA leitura
// por página (a caixa de entrada a repassa à lista e ao fio; o quadro do
// funil, aos cards). `useClienteIdealDoContato`: o porquê de UM contato, para
// o painel.
//
// ⚠️ `null` = "não sei" (primeira carga não chegou, ou falhou): o selo CALA.
// Nunca um mapa vazio, que afirmaria "ninguém é cliente ideal". A recarga que
// falha depois de uma boa MANTÉM a anterior (selo velho é melhor que selo
// sumindo). É a régua do `useInadimplencia` e do `useSinalDeExecucoes`.
//
// Relê no `resyncToken` da página, no evento `EVENTO_CLIENTE_IDEAL` (a ficha
// gravou um campo; a regra mudou) e a cada 5 minutos com a aba visível — o
// Typebot grava as respostas pela API, sem evento nenhum na tela.
// ============================================================

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  EVENTO_CLIENTE_IDEAL,
  lerDetalheDoClienteIdeal,
  type DetalheDoClienteIdeal,
  type NivelDeClienteIdeal,
} from "@/lib/contacts/cliente-ideal";
import { lerClientesIdeais } from "@/lib/contacts/cliente-ideal-leitura";
import { createClient } from "@/lib/supabase/client";

/** De quanto em quanto tempo as telas relêem com a aba visível. */
export const RECARGA_DO_CLIENTE_IDEAL_MS = 5 * 60_000;

export type MapaDeClientesIdeais = ReadonlyMap<string, NivelDeClienteIdeal>;

/** O contador que faz as leituras relerem (evento + relógio da aba visível). */
function useVersaoDoClienteIdeal(): number {
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    const aoMudar = () => setVersao((v) => v + 1);
    window.addEventListener(EVENTO_CLIENTE_IDEAL, aoMudar);
    const tique = setInterval(() => {
      if (document.visibilityState === "visible") setVersao((v) => v + 1);
    }, RECARGA_DO_CLIENTE_IDEAL_MS);
    return () => {
      window.removeEventListener(EVENTO_CLIENTE_IDEAL, aoMudar);
      clearInterval(tique);
    };
  }, []);
  return versao;
}

export function useClientesIdeais(resyncToken: number = 0): MapaDeClientesIdeais | null {
  const { accountId } = useAuth();
  const versao = useVersaoDoClienteIdeal();
  // Carimbado com a conta: a de outra conta (troca com a tela aberta) não vale.
  const [leitura, setLeitura] = useState<{ de: string; mapa: Map<string, NivelDeClienteIdeal> } | null>(
    null,
  );

  useEffect(() => {
    if (!accountId) return;
    let cancelado = false;
    void (async () => {
      const linhas = await lerClientesIdeais(createClient(), accountId);
      // Falha: a leitura anterior fica (ver o cabeçalho).
      if (cancelado || !linhas) return;
      setLeitura({ de: accountId, mapa: new Map(linhas.map((l) => [l.contact_id, l.nivel])) });
    })();
    return () => {
      cancelado = true;
    };
  }, [accountId, versao, resyncToken]);

  return leitura && leitura.de === accountId ? leitura.mapa : null;
}

/**
 * O porquê de UM contato. `carregando` vale até a leitura DESTE contato voltar
 * (efeito passivo: no primeiro render depois da troca o estado ainda é do
 * anterior); `detalhe` nulo depois de carregar = a leitura falhou.
 */
export function useClienteIdealDoContato(
  contactId: string | null,
  resyncToken: number = 0,
): { carregando: boolean; detalhe: DetalheDoClienteIdeal | null } {
  const versao = useVersaoDoClienteIdeal();
  const [leitura, setLeitura] = useState<{ de: string; detalhe: DetalheDoClienteIdeal | null } | null>(
    null,
  );

  useEffect(() => {
    if (!contactId) return;
    let cancelado = false;
    void (async () => {
      const { data, error } = await createClient().rpc("cb_cliente_ideal_do_contato", {
        p_contato: contactId,
      });
      if (cancelado) return;
      setLeitura((anterior) => {
        const lido = error ? null : lerDetalheDoClienteIdeal(data);
        // A releitura que falha do MESMO contato mantém a anterior.
        if (!lido && anterior?.de === contactId) return anterior;
        return { de: contactId, detalhe: lido };
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [contactId, versao, resyncToken]);

  if (!contactId || !leitura || leitura.de !== contactId) {
    return { carregando: !!contactId, detalhe: null };
  }
  return { carregando: false, detalhe: leitura.detalhe };
}

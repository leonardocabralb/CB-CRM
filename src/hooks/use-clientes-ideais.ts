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

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  EVENTO_CLIENTE_IDEAL,
  lerDetalheDoClienteIdeal,
  type DetalheDoClienteIdeal,
  type NivelDeClienteIdeal,
} from "@/lib/contacts/cliente-ideal";
import { lerClientesIdeais, lerNegociosDosContatos } from "@/lib/contacts/cliente-ideal-leitura";
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

/**
 * O mapa contato → nível. `funil` (1125): o quadro de UM funil passa o dele —
 * só valem os perfis daquele funil, e o card do Jurídico fica sem selo mesmo
 * que o contato tenha card no Comercial. Nulo = caixa de entrada e painel.
 */
export function useClientesIdeais(
  resyncToken: number = 0,
  funil: string | null = null,
): MapaDeClientesIdeais | null {
  const { accountId } = useAuth();
  const versao = useVersaoDoClienteIdeal();
  // ⚠️ Carimbado com a conta E o funil: o mapa de outra conta, ou do funil
  // de antes da troca, marcaria os cards errados — é `null` até a leitura
  // deste voltar.
  const dono = accountId ? `${accountId}|${funil ?? ''}` : null;
  const [leitura, setLeitura] = useState<{ de: string; mapa: Map<string, NivelDeClienteIdeal> } | null>(
    null,
  );

  useEffect(() => {
    if (!accountId || !dono) return;
    let cancelado = false;
    void (async () => {
      const linhas = await lerClientesIdeais(createClient(), accountId, funil);
      // Falha: a leitura anterior DESTE dono fica (ver o cabeçalho).
      if (cancelado || !linhas) return;
      setLeitura({ de: dono, mapa: new Map(linhas.map((l) => [l.contact_id, l.nivel])) });
    })();
    return () => {
      cancelado = true;
    };
  }, [accountId, dono, funil, versao, resyncToken]);

  return leitura && leitura.de === dono ? leitura.mapa : null;
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

/**
 * Os ids dos NEGÓCIOS de clientes ideais (só o nível `ideal`), para o
 * interruptor "Só clientes ideais" do quadro do funil. Só pergunta com
 * `ligado` — ver `lerNegociosDosContatos`.
 *
 * Relê quando o mapa muda (a recarga de 5 min, a ficha que grava um campo) e
 * quando `versaoDosNegocios` muda: a página conta as releituras da lista
 * INTEIRA (carga, salvamento, volta ao app). ⚠️ Nunca o tamanho da lista:
 * trocar o contato de um card não o muda (Codex, PR #466). A releitura que
 * falha MANTÉM a anterior; sem anterior,
 * `falhou` — e o quadro, com `ids` nulo, não recorta (nunca "funil vazio").
 * Desligado, ou com o mapa ainda desconhecido, `ids` é nulo.
 */
export function useNegociosDeClientesIdeais(
  mapa: MapaDeClientesIdeais | null,
  ligado: boolean,
  versaoDosNegocios: number,
  /** O funil do mapa (1125): carimba a leitura, como o próprio mapa. */
  funil: string | null = null,
): { ids: ReadonlySet<string> | null; falhou: boolean } {
  const { accountId } = useAuth();
  const dono = accountId ? `${accountId}|${funil ?? ''}` : null;
  const contatos = useMemo(
    () =>
      mapa === null
        ? null
        : [...mapa].filter(([, nivel]) => nivel === "ideal").map(([id]) => id),
    [mapa],
  );
  // Carimbada com a conta E o funil: os negócios de outra conta (troca com a
  // tela aberta) esvaziariam o quadro, e os do funil de antes da troca o
  // recortariam pelos perfis errados, até a releitura voltar.
  const [leitura, setLeitura] = useState<{
    de: string;
    ids: Set<string> | null;
    falhou: boolean;
  } | null>(null);

  useEffect(() => {
    if (!ligado || contatos === null || !dono) return;
    let cancelado = false;
    void (async () => {
      const ids = await lerNegociosDosContatos(createClient(), contatos);
      if (cancelado) return;
      setLeitura((anterior) => {
        if (ids) return { de: dono, ids, falhou: false };
        // A releitura que falha mantém a anterior DESTE dono.
        if (anterior?.de === dono && anterior.ids) return anterior;
        return { de: dono, ids: null, falhou: true };
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [ligado, contatos, versaoDosNegocios, dono]);

  if (!ligado || contatos === null || !leitura || leitura.de !== dono) {
    return { ids: null, falhou: false };
  }
  return { ids: leitura.ids, falhou: leitura.falhou };
}

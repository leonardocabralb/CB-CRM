"use client";

// ============================================================
// Os funis e as etapas da conta, para o nó "Mover card" do robô (CB,
// 26/09/2026, migration 1053): o formulário escolhe funil → etapa e as
// etapas de origem, e o cartão do nó mostra o NOME da etapa de destino.
//
// Carregado UMA vez, no provider do editor (`flow-editor-state.tsx`), e lido
// pelo contexto — no cartão de cada nó, um hook próprio seria uma consulta
// por nó. "Tentar de novo" (o botão do aviso de falha) refaz a consulta.
//
// ⚠️ Três estados, nunca dois: "carregando" e "falhou" NÃO são "a conta não
// tem funil". Um seletor vazio durante a carga afirmaria que não há etapa
// para onde mover — a armadilha da lista vazia virando afirmação.
//
// ⚠️⚠️ RECORTADO PELA CONTA DO ROBÔ (`flows.account_id`), nunca só pela RLS:
// a leitura da 1032 (`cb_contas_do_usuario()`) devolve os funis de TODA conta
// de que a pessoa é membro, e o funil de outra conta seria oferecido e depois
// recusado na ativação ("não existe mais") — a tela mentindo sobre um funil
// que existe. É o mesmo defeito que o Codex achou no "Onde atua" do F2 (#309).
// As etapas vêm só dos funis lidos (`.in('pipeline_id', …)`):
// `pipeline_stages` não tem `account_id`.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

export interface EtapaDoCatalogo {
  id: string;
  name: string;
}

export interface FunilDoCatalogo {
  id: string;
  name: string;
  etapas: EtapaDoCatalogo[];
}

export type CatalogoDoFunil =
  | { status: "carregando" }
  | { status: "falhou" }
  | { status: "pronto"; funis: FunilDoCatalogo[] };

/**
 * Puro: agrupa as etapas por funil, na ordem dos funis recebida e, dentro de
 * cada um, pela `position` da etapa. Etapa de funil que não veio na lista
 * fica de fora (a RLS devolve os dois recortes pela mesma conta; um
 * desencontro é funil apagado no meio da leitura).
 */
export function montarCatalogo(
  funis: ReadonlyArray<{ id: string; name: string }>,
  etapas: ReadonlyArray<{ id: string; name: string; pipeline_id: string; position: number | null }>,
): FunilDoCatalogo[] {
  const porFunil = new Map<string, Array<{ id: string; name: string; position: number }>>();
  for (const e of etapas) {
    const lista = porFunil.get(e.pipeline_id) ?? [];
    lista.push({ id: e.id, name: e.name, position: e.position ?? 0 });
    porFunil.set(e.pipeline_id, lista);
  }
  return funis.map((f) => ({
    id: f.id,
    name: f.name,
    etapas: (porFunil.get(f.id) ?? [])
      .sort((a, b) => a.position - b.position)
      .map(({ id, name }) => ({ id, name })),
  }));
}

/** Puro: o nome da etapa, ou `null` quando o catálogo não a conhece (ainda). */
export function nomeDaEtapa(catalogo: CatalogoDoFunil, etapaId: string): string | null {
  if (catalogo.status !== "pronto") return null;
  for (const f of catalogo.funis) {
    const e = f.etapas.find((x) => x.id === etapaId);
    if (e) return e.name;
  }
  return null;
}

type LinhaDeEtapa = { id: string; name: string; pipeline_id: string; position: number | null };

/**
 * I/O: os funis DESTA conta e as etapas deles. Falha em qualquer das duas
 * leituras = "falhou" (nunca um catálogo pela metade).
 */
export async function carregarCatalogoDoFunil(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogoDoFunil> {
  const funis = await db
    .from("pipelines")
    .select("id, name")
    .eq("account_id", accountId)
    .order("name");
  if (funis.error) return { status: "falhou" };
  const lista = (funis.data ?? []) as Array<{ id: string; name: string }>;
  if (lista.length === 0) return { status: "pronto", funis: [] };
  const etapas = await db
    .from("pipeline_stages")
    .select("id, name, pipeline_id, position")
    .in(
      "pipeline_id",
      lista.map((f) => f.id),
    )
    .order("position");
  if (etapas.error) return { status: "falhou" };
  return { status: "pronto", funis: montarCatalogo(lista, (etapas.data ?? []) as LinhaDeEtapa[]) };
}

export function useCatalogoDoFunil(accountId: string): {
  catalogo: CatalogoDoFunil;
  tentarDeNovo: () => void;
} {
  const [catalogo, setCatalogo] = useState<CatalogoDoFunil>({ status: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let vivo = true;
    carregarCatalogoDoFunil(createClient(), accountId).then(
      (c) => {
        if (vivo) setCatalogo(c);
      },
      // Rede que LANÇA (em vez de devolver `error`) não pode deixar o
      // formulário em "carregando" para sempre.
      () => {
        if (vivo) setCatalogo({ status: "falhou" });
      },
    );
    return () => {
      vivo = false;
    };
  }, [accountId, tentativa]);
  // O "carregando" é posto no CLIQUE (evento), nunca dentro do efeito:
  // setState síncrono em efeito é erro do React Compiler.
  const tentarDeNovo = useCallback(() => {
    setCatalogo({ status: "carregando" });
    setTentativa((n) => n + 1);
  }, []);
  return { catalogo, tentarDeNovo };
}

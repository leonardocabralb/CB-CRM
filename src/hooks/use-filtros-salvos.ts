"use client";

// ============================================================
// Os filtros salvos da conta (migration 967).
//
// Escrita DIRETA do navegador sob RLS, sem rota de servidor — o mesmo regime
// das favoritas (924) e das etiquetas. Rota só se justifica quando há efeito
// colateral (a anotação dispara notificação de menção); aqui não há: é uma
// linha com um nome e um JSON.
//
// ⚠️ A GUARDA DE PAPEL É DO BANCO, e o `useCan` da tela é só cortesia. As
// policies da 967 exigem `admin` para INSERT/UPDATE/DELETE, e RLS que barra
// escrita **não devolve erro — devolve 0 linhas**, com `error: null` e cara de
// sucesso. Por isso toda escrita aqui pede `.select("id")` e confere o
// ROWCOUNT: sem isso, um `agent` renomeia um filtro, vê o nome mudar na tela,
// recarrega e encontra o nome velho de volta.
// ============================================================

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import type { FiltrosDoInbox } from "@/lib/inbox/filtros";
import {
  escreverFiltroSalvo,
  lerFiltroSalvo,
  type FiltroSalvo,
} from "@/lib/inbox/filtros-salvos";

/**
 * O que pode dar errado numa escrita. `nome-repetido` é o 23505 do índice
 * único — a tela transforma em pergunta ("já existe 'SDR', substituir?"), que
 * é quase sempre a intenção; os outros dois viram aviso.
 */
export type ResultadoDaEscrita = "ok" | "nome-repetido" | "sem-permissao" | "erro";

export interface UseFiltrosSalvosResult {
  salvos: FiltroSalvo[];
  /** `true` até a primeira resposta (ou falha) chegar. */
  carregando: boolean;
  /** A leitura falhou — o menu não pode afirmar "não há filtro salvo". */
  falhou: boolean;
  criar: (nome: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  /** Grava um recorte novo por cima de um filtro que já existe. */
  regravar: (id: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  renomear: (id: string, nome: string) => Promise<ResultadoDaEscrita>;
  apagar: (id: string) => Promise<ResultadoDaEscrita>;
}

interface LinhaCrua {
  id: string;
  nome: string;
  filtros: unknown;
}

/** Ordem alfabética, insensível a acento e caixa — é como o olho procura. */
function ordenar(lista: FiltroSalvo[]): FiltroSalvo[] {
  return [...lista].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export function useFiltrosSalvos(): UseFiltrosSalvosResult {
  const { accountId, user } = useAuth();
  const userId = user?.id ?? null;
  const [salvos, setSalvos] = useState<FiltroSalvo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelado = false;
    void (async () => {
      const { data, error } = await supabase
        .from("cb_inbox_saved_filters")
        .select("id, nome, filtros");
      if (cancelado) return;
      if (error || !data) {
        // ⚠️ Não dá para tratar como "não há filtro salvo": o menu diria isso
        // a quem montou seis recortes ontem, e a única saída visível seria
        // remontá-los à mão.
        setFalhou(true);
        setCarregando(false);
        return;
      }
      setFalhou(false);
      setSalvos(
        ordenar(
          (data as LinhaCrua[]).map((r) => ({
            id: r.id,
            nome: r.nome,
            // ⚠️ PARSE, nunca cast — ver `lerFiltroSalvo`.
            filtros: lerFiltroSalvo(r.filtros),
          })),
        ),
      );
      setCarregando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [accountId]);

  /**
   * Traduz o erro do PostgREST.
   *
   * `23505` é o índice único de nome; `42501` é o REVOKE (não acontece hoje,
   * porque `authenticated` tem os quatro privilégios, mas se um dia a tabela
   * for fechada é isto que chega).
   */
  const classificar = (code: string | undefined): ResultadoDaEscrita => {
    if (code === "23505") return "nome-repetido";
    if (code === "42501") return "sem-permissao";
    return "erro";
  };

  const criar = useCallback(
    async (nome: string, filtros: FiltrosDoInbox): Promise<ResultadoDaEscrita> => {
      if (!accountId) return "erro";
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cb_inbox_saved_filters")
        .insert({
          account_id: accountId,
          nome: nome.trim(),
          filtros: escreverFiltroSalvo(filtros),
          criado_por: userId,
        })
        .select("id, nome, filtros")
        .maybeSingle();

      if (error) return classificar(error.code);
      // ⚠️ INSERT barrado pela policy volta SEM erro e SEM linha (o
      // `RETURNING` não enxerga o que a RLS recusou). Sem esta checagem, um
      // `agent` veria o filtro aparecer na tela e sumir no reload.
      if (!data) return "sem-permissao";

      const linha = data as LinhaCrua;
      setSalvos((prev) =>
        ordenar([
          ...prev,
          { id: linha.id, nome: linha.nome, filtros: lerFiltroSalvo(linha.filtros) },
        ]),
      );
      return "ok";
    },
    [accountId, userId],
  );

  const regravar = useCallback(
    async (id: string, filtros: FiltrosDoInbox): Promise<ResultadoDaEscrita> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cb_inbox_saved_filters")
        .update({
          filtros: escreverFiltroSalvo(filtros),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select("id");
      if (error) return classificar(error.code);
      if (!data || data.length === 0) return "sem-permissao";
      setSalvos((prev) =>
        prev.map((f) => (f.id === id ? { ...f, filtros } : f)),
      );
      return "ok";
    },
    [],
  );

  const renomear = useCallback(
    async (id: string, nome: string): Promise<ResultadoDaEscrita> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("cb_inbox_saved_filters")
        .update({ nome: nome.trim(), updated_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      if (error) return classificar(error.code);
      if (!data || data.length === 0) return "sem-permissao";
      setSalvos((prev) =>
        ordenar(prev.map((f) => (f.id === id ? { ...f, nome: nome.trim() } : f))),
      );
      return "ok";
    },
    [],
  );

  const apagar = useCallback(async (id: string): Promise<ResultadoDaEscrita> => {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("cb_inbox_saved_filters")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) return classificar(error.code);
    // DELETE que a RLS filtra volta "0 linhas" com `error: null` — a classe
    // "0 linhas em silêncio" do CLAUDE.md.
    if (!data || data.length === 0) return "sem-permissao";
    setSalvos((prev) => prev.filter((f) => f.id !== id));
    return "ok";
  }, []);

  return { salvos, carregando, falhou, criar, regravar, renomear, apagar };
}

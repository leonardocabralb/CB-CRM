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
  /**
   * O filtro que ESTE membro escolheu como padrão (968), ou `null`.
   *
   * ⚠️ É de cada um, sobre um filtro que é da conta. A policy já filtra por
   * `auth.uid()`, então a consulta abaixo não repete o recorte — mas o
   * `user_id` do upsert precisa estar certo, porque é ele que a policy compara.
   */
  padraoId: string | null;
  /** `true` até a primeira resposta (ou falha) chegar. */
  carregando: boolean;
  /** A leitura falhou — o menu não pode afirmar "não há filtro salvo". */
  falhou: boolean;
  criar: (nome: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  /** Grava um recorte novo por cima de um filtro que já existe. */
  regravar: (id: string, filtros: FiltrosDoInbox) => Promise<ResultadoDaEscrita>;
  renomear: (id: string, nome: string) => Promise<ResultadoDaEscrita>;
  apagar: (id: string) => Promise<ResultadoDaEscrita>;
  /** `null` desmarca — o inbox volta a abrir sem recorte. */
  definirPadrao: (filtroId: string | null) => Promise<ResultadoDaEscrita>;
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
  const { accountId, user, profileLoading } = useAuth();
  const userId = user?.id ?? null;
  const [salvos, setSalvos] = useState<FiltroSalvo[]>([]);
  const [padraoId, setPadraoId] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(true);
  /**
   * ⚠️ DERIVADO, e não o `buscando` cru. Sem conta resolvida o efeito abaixo
   * não busca nada e `buscando` ficaria `true` para sempre — e como a LISTA do
   * inbox segura o spinner enquanto o filtro padrão pode entrar
   * (`esperandoPadrao`), isso viraria uma caixa de entrada girando eternamente
   * para quem tem o perfil quebrado. Com o perfil resolvido e ainda sem conta,
   * não há o que carregar: a tela segue sem filtro salvo, que é a verdade.
   */
  const carregando = buscando && (profileLoading || !!accountId);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelado = false;
    void (async () => {
      // ⚠️ As duas JUNTAS, e `carregando` só cai quando as duas voltam: quem
      // semeia o filtro padrão precisa saber que já sabe — com a lista pronta
      // e o padrão ainda em voo, a semente rodaria achando que não há padrão
      // nenhum, e o inbox abriria sem recorte para sempre (a semente é de uma
      // vez só, de propósito).
      const [{ data, error }, padraoRes] = await Promise.all([
        supabase.from("cb_inbox_saved_filters").select("id, nome, filtros"),
        supabase.from("cb_inbox_filtro_padrao").select("filtro_id").maybeSingle(),
      ]);
      if (cancelado) return;
      // Sem padrão escolhido é `data: null` sem erro; erro de verdade some com
      // o padrão desta carga, o que é o lado seguro (abre sem recorte, e o
      // menu continua dizendo qual filtro está marcado depois do próximo
      // carregamento).
      setPadraoId(
        (padraoRes.data as { filtro_id: string } | null)?.filtro_id ?? null,
      );
      if (error || !data) {
        // ⚠️ Não dá para tratar como "não há filtro salvo": o menu diria isso
        // a quem montou seis recortes ontem, e a única saída visível seria
        // remontá-los à mão.
        setFalhou(true);
        setBuscando(false);
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
      setBuscando(false);
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
    // O CASCADE da 968 já apagou a linha do padrão no banco; sem esta linha a
    // tela seguiria marcando com a estrela um filtro que não existe mais.
    setPadraoId((atual) => (atual === id ? null : atual));
    return "ok";
  }, []);

  /**
   * ⚠️ Upsert com alvo `(user_id, account_id)`, que é a PK — índice TOTAL, e
   * por isso serve de `ON CONFLICT` (os índices PARCIAIS da 903 não servem, e
   * é o erro que o CLAUDE.md documenta).
   */
  const definirPadrao = useCallback(
    async (filtroId: string | null): Promise<ResultadoDaEscrita> => {
      if (!accountId || !userId) return "erro";
      const supabase = createClient();

      if (filtroId === null) {
        const { error } = await supabase
          .from("cb_inbox_filtro_padrao")
          .delete()
          .eq("user_id", userId)
          .eq("account_id", accountId);
        if (error) return classificar(error.code);
        setPadraoId(null);
        return "ok";
      }

      const { data, error } = await supabase
        .from("cb_inbox_filtro_padrao")
        .upsert(
          {
            user_id: userId,
            account_id: accountId,
            filtro_id: filtroId,
            definido_em: new Date().toISOString(),
          },
          { onConflict: "user_id,account_id" },
        )
        .select("filtro_id");
      if (error) return classificar(error.code);
      if (!data || data.length === 0) return "sem-permissao";
      setPadraoId(filtroId);
      return "ok";
    },
    [accountId, userId],
  );

  return {
    salvos,
    padraoId,
    carregando,
    falhou,
    criar,
    regravar,
    renomear,
    apagar,
    definirPadrao,
  };
}

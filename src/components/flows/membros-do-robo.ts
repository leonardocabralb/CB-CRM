"use client";

// ============================================================
// Os membros da conta do robô, para o "Atribuir a" do bloco "Transferir para
// atendente" (item 2.7 do plano do previdenciário, CB, 26/09/2026): o
// formulário oferece a lista e o cartão do nó mostra o NOME de quem recebe.
//
// Carregado UMA vez, no provider do editor (`flow-editor-state.tsx`), como o
// catálogo de funis (`catalogo-do-funil.ts`) — no cartão de cada nó, um hook
// próprio seria uma consulta por nó.
//
// ⚠️ Três estados, nunca dois: "carregando" e "falhou" NÃO são "a conta não
// tem ninguém". O nome gravado continua aparecendo como "a pessoa escolhida"
// enquanto a lista não chega — nunca o UUID, nunca vazio.
//
// ⚠️⚠️ RECORTADO PELA CONTA DO ROBÔ (`flows.account_id`), nunca só pela RLS:
// a leitura de `profiles` devolve os membros de TODA conta de que a pessoa é
// membro, e o membro de outra conta seria oferecido e depois recusado na
// ativação — a mesma lição do catálogo de funis (Codex, PR #314).
//
// ⚠️ O valor gravado é `profiles.user_id` (o id de LOGIN, o que
// `conversations.assigned_agent_id` guarda), NUNCA `profiles.id`.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";

export interface MembroDoRobo {
  /** `profiles.user_id` — o que o nó grava em `assign_to`. */
  userId: string;
  /** Nome, senão e-mail; vazio = a tela escreve "membro sem nome". */
  nome: string;
}

export type MembrosDoRobo =
  | { status: "carregando" }
  | { status: "falhou" }
  | { status: "pronto"; membros: MembroDoRobo[] };

type LinhaDePerfil = { user_id: string; full_name: string | null; email: string | null };

/** Puro: as linhas de `profiles` viram a lista, em ordem de nome. */
export function montarMembros(linhas: ReadonlyArray<LinhaDePerfil>): MembroDoRobo[] {
  const vistos = new Set<string>();
  const lista: MembroDoRobo[] = [];
  for (const l of linhas) {
    if (!l.user_id || vistos.has(l.user_id)) continue;
    vistos.add(l.user_id);
    lista.push({ userId: l.user_id, nome: l.full_name?.trim() || l.email?.trim() || "" });
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Puro: o nome de quem recebe, ou `null` quando a lista não o conhece (ainda). */
export function nomeDoMembro(membros: MembrosDoRobo, userId: string): string | null {
  if (membros.status !== "pronto") return null;
  return membros.membros.find((m) => m.userId === userId)?.nome ?? null;
}

/** I/O: os membros DESTA conta. Falha = "falhou", nunca lista vazia. */
export async function carregarMembrosDoRobo(
  db: SupabaseClient,
  accountId: string,
): Promise<MembrosDoRobo> {
  const { data, error } = await db
    .from("profiles")
    .select("user_id, full_name, email")
    .eq("account_id", accountId);
  if (error) return { status: "falhou" };
  return { status: "pronto", membros: montarMembros((data ?? []) as LinhaDePerfil[]) };
}

export function useMembrosDoRobo(accountId: string): {
  membros: MembrosDoRobo;
  tentarDeNovo: () => void;
} {
  const [membros, setMembros] = useState<MembrosDoRobo>({ status: "carregando" });
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let vivo = true;
    carregarMembrosDoRobo(createClient(), accountId).then(
      (m) => {
        if (vivo) setMembros(m);
      },
      // Rede que LANÇA não pode deixar o formulário em "carregando" para sempre.
      () => {
        if (vivo) setMembros({ status: "falhou" });
      },
    );
    return () => {
      vivo = false;
    };
  }, [accountId, tentativa]);
  // O "carregando" vai no CLIQUE (evento), nunca dentro do efeito: setState
  // síncrono em efeito é erro do React Compiler.
  const tentarDeNovo = useCallback(() => {
    setMembros({ status: "carregando" });
    setTentativa((n) => n + 1);
  }, []);
  return { membros, tentarDeNovo };
}

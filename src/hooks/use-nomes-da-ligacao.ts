"use client";

// ============================================================
// Os nomes que a ligação pelo CRM mostra (4c): quem atendeu ("Atendida por
// Ana", "Em ligação com Ana") e quem liga (a ficha da linha ao vivo). A linha
// ao vivo traz só os ids. Guardados no módulo: a mesma ligação aparece no
// cartão, no painel e no botão.
// ============================================================

import { useEffect, useState } from "react";

import { fetchAccountMembersOrNull, memberLabel } from "@/lib/account/members";
import { createClient } from "@/lib/supabase/client";

let membros: Promise<Map<string, string> | null> | null = null;

function lerMembros(): Promise<Map<string, string> | null> {
  if (!membros) {
    membros = fetchAccountMembersOrNull().then((lista) => {
      if (!lista) {
        // Falhou: a próxima pergunta tenta de novo.
        membros = null;
        return null;
      }
      return new Map(lista.map((m) => [m.user_id, memberLabel(m)]));
    });
  }
  return membros;
}

/** O nome do membro, ou `null` enquanto não sabe (a tela escreve sem o nome). */
export function useNomeDoMembro(userId: string | null): string | null {
  const [lido, setLido] = useState<{ de: string; nome: string | null } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    void lerMembros().then((mapa) => {
      if (vivo) setLido({ de: userId, nome: mapa?.get(userId) ?? null });
    });
    return () => {
      vivo = false;
    };
  }, [userId]);
  // Carimbo do dono: o render da troca de id não mostra o nome do anterior.
  return userId && lido?.de === userId ? lido.nome : null;
}

const contatos = new Map<string, Promise<string | null>>();

function lerContato(id: string): Promise<string | null> {
  let pedido = contatos.get(id);
  if (!pedido) {
    pedido = (async () => {
      const { data, error } = await createClient()
        .from("contacts")
        .select("name")
        .eq("id", id)
        .maybeSingle();
      if (error) {
        contatos.delete(id);
        return null;
      }
      // Só o NOME: sem ele a tela escreve o telefone da linha ao vivo,
      // formatado (o da ficha viria em dígitos crus).
      return data?.name?.trim() || null;
    })();
    contatos.set(id, pedido);
  }
  return pedido;
}

/** O nome da ficha, ou `null` (sem ficha, carregando ou falhou: a tela mostra o telefone). */
export function useNomeDoContato(contactId: string | null): string | null {
  const [lido, setLido] = useState<{ de: string; nome: string | null } | null>(null);
  useEffect(() => {
    if (!contactId) return;
    let vivo = true;
    void lerContato(contactId).then((nome) => {
      if (vivo) setLido({ de: contactId, nome });
    });
    return () => {
      vivo = false;
    };
  }, [contactId]);
  return contactId && lido?.de === contactId ? lido.nome : null;
}

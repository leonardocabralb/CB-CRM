"use client";

// ============================================================
// Os nomes de quem está em cada grupo (1126), para a busca da caixa de
// entrada achar o grupo pelo nome de um participante.
//
// ⚠️ SÓ PERGUNTA COM TERMO DE BUSCA (`ativo`): a lista recarrega ~1.500 vezes
// por dia, e o banco já esteve no teto de conexões — uma consulta a mais por
// carga, para uma busca rara, não se paga. A primeira busca pergunta; as
// seguintes reusam; o `resyncToken` (volta à aba) faz a PRÓXIMA busca reler.
//
// `null` = não sei (ainda não perguntou, ou falhou): a busca por participante
// simplesmente não soma nada. A releitura que falha mantém a anterior.
// ============================================================

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { lerNomesNosGrupos, type NomesNosGrupos } from "@/lib/cb-groups/nomes-nos-grupos";
import { createClient } from "@/lib/supabase/client";

export function useNomesNosGrupos(ativo: boolean, resyncToken: number = 0): NomesNosGrupos | null {
  const { accountId } = useAuth();
  // Carimbada com a conta E com o `resyncToken` em que foi lida.
  const [leitura, setLeitura] = useState<{
    de: string;
    token: number;
    mapa: Map<string, string[]>;
  } | null>(null);

  // Precisa (re)ler: há busca no ar e a leitura não é desta conta ou desta
  // volta à aba. Lida, isto vira falso e o efeito para sozinho.
  const precisa =
    ativo && !!accountId && (leitura?.de !== accountId || leitura.token !== resyncToken);

  useEffect(() => {
    if (!precisa || !accountId) return;
    let cancelado = false;
    void (async () => {
      const mapa = await lerNomesNosGrupos(createClient(), accountId);
      // Falha: a anterior fica (e a próxima volta à aba tenta de novo).
      if (cancelado || !mapa) return;
      setLeitura({ de: accountId, token: resyncToken, mapa });
    })();
    return () => {
      cancelado = true;
    };
  }, [precisa, accountId, resyncToken]);

  return leitura && leitura.de === accountId ? leitura.mapa : null;
}

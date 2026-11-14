"use client";

// ============================================================
// Os nomes de quem está em cada grupo (1126), para a busca da caixa de
// entrada achar o grupo pelo nome de um participante.
//
// ⚠️ SÓ PERGUNTA COM TERMO DE BUSCA (`ativo`): a lista recarrega ~1.500 vezes
// por dia, e o banco já esteve no teto de conexões — uma consulta a mais por
// carga, para uma busca rara, não se paga. A primeira busca pergunta; as
// seguintes reusam; o `resyncToken` (volta à aba) faz reler — na hora, se já
// há termo na caixa; senão, na próxima busca.
//
// ⚠️ `carregando` e `falhou` são o que a lista mostra ao lado da busca: sem
// eles, "ainda lendo" e "a leitura falhou" eram iguais a "nenhum grupo com
// esse participante", e quem buscava concluía que o grupo não está no CRM (a
// lista vazia virando afirmação, CLAUDE.md 8c). A releitura que falha mantém
// a anterior, sem aviso; a primeira que falha avisa e tenta de novo em 30 s.
// ============================================================

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import { lerNomesNosGrupos, type NomesNosGrupos } from "@/lib/cb-groups/nomes-nos-grupos";
import { createClient } from "@/lib/supabase/client";

/** Depois de uma leitura que falhou, quanto esperar para tentar de novo. */
export const NOVA_TENTATIVA_DOS_NOMES_MS = 30_000;

export interface NomesNosGruposNaTela {
  /** `null` = não sei (ainda não leu, ou falhou sem uma leitura anterior). */
  mapa: NomesNosGrupos | null;
  /** Há busca e nenhuma leitura desta conta ainda: a busca por participante não somou nada AINDA. */
  carregando: boolean;
  /** A leitura falhou e não há uma anterior: a busca por participante ficou de fora. */
  falhou: boolean;
}

export function useNomesNosGrupos(ativo: boolean, resyncToken: number = 0): NomesNosGruposNaTela {
  const { accountId } = useAuth();
  // Carimbada com a conta E com o `resyncToken` em que foi lida.
  const [leitura, setLeitura] = useState<{
    de: string;
    token: number;
    mapa: Map<string, string[]>;
  } | null>(null);
  // A leitura que FALHOU, carimbada com a conta, a volta à aba e a tentativa:
  // é o que para o efeito (senão ele leria de novo a cada render) e o que a
  // nova tentativa (`vez`) solta.
  const [falha, setFalha] = useState<{ de: string; token: number; vez: number } | null>(null);
  const [vez, setVez] = useState(0);

  const falhouAgora =
    !!falha && falha.de === accountId && falha.token === resyncToken && falha.vez === vez;
  // Precisa (re)ler: há busca no ar, a leitura não é desta conta ou desta volta
  // à aba, e esta tentativa ainda não falhou.
  const precisa =
    ativo &&
    !!accountId &&
    !(leitura && leitura.de === accountId && leitura.token === resyncToken) &&
    !falhouAgora;

  useEffect(() => {
    if (!precisa || !accountId) return;
    let cancelado = false;
    void (async () => {
      const mapa = await lerNomesNosGrupos(createClient(), accountId);
      if (cancelado) return;
      if (!mapa) {
        // A anterior (se houver) continua valendo; a tela só avisa sem ela.
        setFalha({ de: accountId, token: resyncToken, vez });
        return;
      }
      setFalha(null);
      setLeitura({ de: accountId, token: resyncToken, mapa });
    })();
    return () => {
      cancelado = true;
    };
  }, [precisa, accountId, resyncToken, vez]);

  // A nova tentativa depois da falha, só com busca no ar.
  useEffect(() => {
    if (!falhouAgora || !ativo) return;
    const espera = setTimeout(() => setVez((v) => v + 1), NOVA_TENTATIVA_DOS_NOMES_MS);
    return () => clearTimeout(espera);
  }, [falhouAgora, ativo]);

  const mapa = leitura && leitura.de === accountId ? leitura.mapa : null;
  return {
    mapa,
    carregando: ativo && !!accountId && !mapa && !falhouAgora,
    falhou: ativo && !mapa && falhouAgora,
  };
}

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  lerRespostaDosParticipantes,
  type RespostaDosParticipantes,
} from "@/lib/cb-groups/participantes-na-tela";
import type { CbGroup } from "@/types";

/** Por que a leitura falhou: a tela escreve uma frase para cada um. */
export type FalhaDosParticipantes = "sem_conexao" | "indisponivel";

interface Leitura {
  de: string | null;
  dados: RespostaDosParticipantes | null;
  falha: FalhaDosParticipantes | null;
}

/**
 * Quem está no grupo, lido AO VIVO pela rota (`findGroupInfos`, ~0,8 s) cada
 * vez que o painel mostra um grupo — e no "Tentar de novo". A mesma leitura
 * diz se o renomear vale (`podeRenomear`) e atualiza o espelho do grupo.
 *
 * ⚠️ Guarda `{ de, dados }` e DERIVA `carregando` de `de !== grupoId`: o
 * painel não remonta na troca de conversa, e entre a troca e a resposta há um
 * render com o grupo NOVO e a lista do ANTERIOR.
 *
 * ⚠️ `onGrupoAtualizado` da página aplica o patch na conversa ABERTA, não pelo
 * id do grupo: a resposta de A que pousa entre a troca e a limpeza do efeito
 * (passivo) gravaria a contagem de A em B. Por isso a conferência pelo grupo
 * NA TELA (`grupoNaTelaRef`, efeito de LAYOUT, que roda no commit).
 */
export function useParticipantesDoGrupo(
  grupoId: string | null | undefined,
  onGrupoAtualizado?: (patch: Partial<CbGroup>) => void,
): {
  dados: RespostaDosParticipantes | null;
  carregando: boolean;
  falha: FalhaDosParticipantes | null;
  recarregar: () => void;
} {
  const [leitura, setLeitura] = useState<Leitura>({ de: null, dados: null, falha: null });
  const [nonce, setNonce] = useState(0);
  const recarregar = useCallback(() => setNonce((n) => n + 1), []);

  const grupoNaTelaRef = useRef(grupoId ?? null);
  const aoAtualizarRef = useRef(onGrupoAtualizado);
  useLayoutEffect(() => {
    grupoNaTelaRef.current = grupoId ?? null;
    aoAtualizarRef.current = onGrupoAtualizado;
  });

  useEffect(() => {
    if (!grupoId) return;
    let vivo = true;
    void (async () => {
      // O "Tentar de novo" mostra a carga de novo (e não a falha velha).
      setLeitura((l) => (l.de === grupoId ? { de: null, dados: null, falha: null } : l));
      const res = await fetch(`/api/cb/groups/${grupoId}/participantes`, { cache: "no-store" }).catch(
        () => null,
      );
      if (!vivo) return;
      const json = res ? await res.json().catch(() => null) : null;
      if (!vivo) return;
      const lida = res?.ok ? lerRespostaDosParticipantes(json) : null;
      if (!lida) {
        const semConexao = (json as { code?: unknown } | null)?.code === "SEM_CONEXAO";
        setLeitura({ de: grupoId, dados: null, falha: semConexao ? "sem_conexao" : "indisponivel" });
        return;
      }
      setLeitura({ de: grupoId, dados: lida, falha: null });
      if (lida.grupo && lida.grupo.id === grupoId && grupoNaTelaRef.current === grupoId) {
        aoAtualizarRef.current?.(lida.grupo);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [grupoId, nonce]);

  const desteGrupo = !!grupoId && leitura.de === grupoId;
  return {
    dados: desteGrupo ? leitura.dados : null,
    carregando: !!grupoId && !desteGrupo,
    falha: desteGrupo ? leitura.falha : null,
    recarregar,
  };
}
